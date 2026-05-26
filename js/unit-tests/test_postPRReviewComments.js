/**
 * Unit tests for agents/js/postPRReviewComments.js.
 */

function loadPostPRReviewComments() {
    return loadModule(
        'agents/js/postPRReviewComments.js',
        makeRequire({
            './config.js': configModule,
            './common/scm.js': { createScm: function() { return {}; } },
            './common/autoStart.js': { triggerConfiguredWorkflowForTicket: function() { return false; } },
            './configLoader.js': configLoaderModule
        }),
        {
            file_read: function() { return null; }
        }
    );
}

function loadPostPRReviewCommentsWithMocks(mocks) {
    return loadModule(
        'agents/js/postPRReviewComments.js',
        makeRequire({
            './config.js': configModule,
            './common/scm.js': { createScm: function() { return {}; } },
            './common/autoStart.js': {
                triggerConfiguredWorkflowForTicket: function() { return false; },
                triggerSmIfIdle: function() {}
            },
            './configLoader.js': configLoaderModule
        }),
        mocks
    );
}

suite('postPRReviewComments', function() {
    test('releases SM lock + WIP in finally even when pr_review.json is malformed', function() {
        var removed = [];
        var comments = [];
        // Realistic culprit: an email regex pasted into a JSON string — "\s" is an invalid
        // JSON escape, so JSON.parse throws and readReviewJson() returns null.
        var badJson = '{"recommendation":"APPROVE","inlineComments":[{"path":"a.ts","line":1,"body":"/^[^\\s@]+$/"}]}';

        var mod = loadPostPRReviewCommentsWithMocks({
            file_read: function(o) {
                return (o && o.path === 'outputs/pr_review.json') ? badJson : null;
            },
            jira_remove_label: function(o) { removed.push(o); },
            jira_post_comment: function(o) { comments.push(o); },
            jira_add_label: function() {},
            jira_move_to_status: function() {},
            jira_assign_ticket_to: function() {}
        });

        var result = mod.action({
            ticket: { key: 'BBP-58', fields: { labels: [] } },
            metadata: { contextId: 'pr_review' },
            jobParams: { customParams: { removeLabel: 'sm_story_review_triggered' } }
        });

        assert.equal(result.success, false, 'parse failure is reported');

        var removedLabels = removed.map(function(r) { return r.label; });
        assert.ok(removedLabels.indexOf('sm_story_review_triggered') !== -1,
            'SM lock released in finally despite the early return');
        assert.ok(removedLabels.indexOf('pr_review_wip') !== -1,
            'WIP label released in finally');
        assert.ok(comments.length >= 1,
            'posts a visible notice that the review output was unreadable');
    });

    test('merges pr_review jobParamPatches into runtime customParams', function() {
        var mod = loadPostPRReviewComments();

        var customParams = mod.resolveCustomParams(
            {
                jobParams: {
                    customParams: {
                        removeLabel: 'sm_story_review_triggered',
                        targetRepository: { owner: 'IstiN', repo: 'trackstate' }
                    }
                }
            },
            {
                jobParamPatches: {
                    pr_review: {
                        customParams: {
                            autoStartRework: true,
                            autoStartReworkConfigFile: 'agents/pr_rework.json',
                            removeLabel: 'from_patch'
                        }
                    }
                }
            }
        );

        assert.equal(customParams.autoStartRework, true);
        assert.equal(customParams.autoStartReworkConfigFile, 'agents/pr_rework.json');
        assert.equal(customParams.removeLabel, 'sm_story_review_triggered');
        assert.deepEqual(customParams.targetRepository, { owner: 'IstiN', repo: 'trackstate' });
    });
});
