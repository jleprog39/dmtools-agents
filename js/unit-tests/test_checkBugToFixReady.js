/**
 * Unit tests for agents/js/checkBugToFixReady.js.
 *
 * Focus: the "all linked Bugs Done → move TC out of Bug To Fix" path must verify
 * the transition actually happened. jira_move_to_status can silently no-op when the
 * target status does not exist in the project's workflow (e.g. a Simplified scheme
 * with no "Backlog" status), which used to strand the TC forever while reporting
 * success — blocking re-automation and therefore all downstream AI agents.
 *
 * Verification is done via JQL (jira_search_by_jql), not jira_get_ticket, because
 * DMTools caches GET-by-key and would return a stale pre-move status in the same run.
 */

/**
 * Build the module under test with a workflow simulation.
 *
 * @param {Object} opts
 *   - notDoneBugs: number of linked Bugs NOT yet Done (0 → ready to move)
 *   - totalBugs: number of linked Bugs
 *   - allowedTargets: array of status names the simulated workflow can transition INTO
 *   - startStatus: initial ticket status (default 'Bug To Fix')
 *   - sink: object collecting comments/removedLabels/addedLabels/state
 */
function loadCheckBugToFixReady(opts) {
    var totalBugs = (typeof opts.totalBugs === 'number') ? opts.totalBugs : 2;
    var notDoneBugs = (typeof opts.notDoneBugs === 'number') ? opts.notDoneBugs : 0;
    var allowed = opts.allowedTargets || [];
    var sink = opts.sink;
    sink.currentStatus = opts.startStatus || 'Bug To Fix';

    function bug(i) { return { key: 'BBP-BUG-' + i }; }

    function quotedStatus(jql) {
        var m = /status = "([^"]+)"/.exec(jql);
        return m ? m[1] : null;
    }

    var mocks = {
        file_read: function() { return null; },
        jira_search_by_jql: function(args) {
            var jql = (args && args.jql) || '';
            // Linked Bugs not-yet-Done query
            if (jql.indexOf('status != "Done"') !== -1) {
                var nd = [];
                for (var i = 0; i < notDoneBugs; i++) nd.push(bug(i));
                return nd;
            }
            // Status verification query: key = X AND status = "Y"
            if (jql.indexOf('key = ') !== -1 && jql.indexOf('status = "') !== -1) {
                var want = quotedStatus(jql);
                return (want && want === sink.currentStatus) ? [{ key: 'BBP-52' }] : [];
            }
            // All linked Bugs query
            var all = [];
            for (var j = 0; j < totalBugs; j++) all.push(bug(j));
            return all;
        },
        jira_move_to_status: function(args) {
            var target = args && args.statusName;
            for (var i = 0; i < allowed.length; i++) {
                if (allowed[i] === target) { sink.currentStatus = allowed[i]; return; }
            }
            // else: silent no-op (status unchanged) — the real bug we guard against
        },
        jira_get_ticket: function(key) {
            // Intentionally returns a STALE status to prove verification does not rely on it.
            return { key: key, fields: { status: { name: 'Bug To Fix' } } };
        },
        jira_remove_label: function(args) { sink.removedLabels.push(args.label); },
        jira_add_label: function(args) { sink.addedLabels.push(args.label); },
        jira_post_comment: function(args) { sink.comments.push(args.comment); }
    };

    var jiraHelpers = loadModule(
        'agents/js/common/jiraHelpers.js',
        makeRequire({ '../config.js': configModule }),
        mocks
    );

    return loadModule(
        'agents/js/checkBugToFixReady.js',
        makeRequire({
            './config.js': configModule,
            './common/jiraHelpers.js': jiraHelpers
        }),
        mocks
    );
}

function freshSink() {
    return { comments: [], removedLabels: [], addedLabels: [], currentStatus: null };
}

function runAction(module, ticketLabels) {
    return module.action({
        ticket: { key: 'BBP-52', fields: { labels: ticketLabels || [] } },
        jobParams: { customParams: { removeLabel: 'sm_bug_to_fix_check_triggered' } }
    });
}

suite('checkBugToFixReady: re-automation transition', function() {

    test('moves TC to Backlog when the workflow has a Backlog status', function() {
        var sink = freshSink();
        var module = loadCheckBugToFixReady({
            totalBugs: 2, notDoneBugs: 0, allowedTargets: ['Backlog'], sink: sink
        });

        var result = runAction(module);

        assert.equal(result.success, true, 'reports success');
        assert.equal(result.action, 'moved_to_backlog');
        assert.equal(result.movedTo, 'Backlog', 'moved via primary target');
        assert.equal(sink.currentStatus, 'Backlog', 'ticket actually left Bug To Fix');
        assert.ok(sink.removedLabels.indexOf('sm_test_automation_triggered') !== -1, 'cleared automation lock');
    });

    test('falls back to To Do when the workflow has no Backlog status', function() {
        var sink = freshSink();
        var module = loadCheckBugToFixReady({
            totalBugs: 3, notDoneBugs: 0, allowedTargets: ['To Do'], sink: sink
        });

        var result = runAction(module);

        assert.equal(result.success, true, 'reports success via fallback');
        assert.equal(result.movedTo, 'To Do', 'moved via fallback target');
        assert.equal(sink.currentStatus, 'To Do', 'ticket actually moved to To Do');
        assert.ok(sink.removedLabels.indexOf('sm_test_automation_triggered') !== -1, 'cleared automation lock');
    });

    test('does NOT report success and alerts once when no transition is available', function() {
        var sink = freshSink();
        var module = loadCheckBugToFixReady({
            totalBugs: 1, notDoneBugs: 0, allowedTargets: [], sink: sink
        });

        var result = runAction(module);

        assert.equal(result.success, false, 'no silent false-success');
        assert.equal(result.action, 'move_unverified');
        assert.equal(sink.currentStatus, 'Bug To Fix', 'ticket stayed put (simulated stuck workflow)');
        assert.ok(sink.comments.length === 1, 'posted exactly one transition alert');
        assert.ok(sink.addedLabels.indexOf('sm_status_move_failed') !== -1, 'marked move-failed for idempotency');
        assert.ok(sink.removedLabels.indexOf('sm_bug_to_fix_check_triggered') !== -1, 'released lock to re-check next cycle');
    });

    test('does NOT re-alert when the move-failed marker is already present', function() {
        var sink = freshSink();
        var module = loadCheckBugToFixReady({
            totalBugs: 1, notDoneBugs: 0, allowedTargets: [], sink: sink
        });

        var result = runAction(module, ['sm_status_move_failed']);

        assert.equal(result.success, false);
        assert.equal(result.action, 'move_unverified');
        assert.equal(sink.comments.length, 0, 'no duplicate alert when already marked');
        assert.equal(sink.addedLabels.indexOf('sm_status_move_failed'), -1, 'does not re-add the marker');
    });

    test('waits (no move) while some linked Bugs are not yet Done', function() {
        var sink = freshSink();
        var module = loadCheckBugToFixReady({
            totalBugs: 3, notDoneBugs: 1, allowedTargets: ['Backlog', 'To Do'], sink: sink
        });

        var result = runAction(module);

        assert.equal(result.action, 'waiting');
        assert.equal(sink.currentStatus, 'Bug To Fix', 'no transition attempted while waiting');
        assert.ok(sink.removedLabels.indexOf('sm_bug_to_fix_check_triggered') !== -1, 'released lock to re-check next cycle');
    });
});
