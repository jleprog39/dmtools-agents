/**
 * Check Bug To Fix Ready — postJSAction for bug_to_fix_check agent.
 *
 * Runs on every SM cycle for each Test Case in "Bug To Fix" status.
 * - Finds all linked Bugs.
 * - If all linked Bugs are in "Done" → moves TC back to the re-automation entry status
 *   (BACKLOG, configurable; falls back to TODO for workflows with no Backlog status).
 *   The transition is verified (jira_move_to_status can silently no-op on a missing
 *   target status), so a stuck workflow fails loud instead of looping silently.
 * - Otherwise → removes the SM idempotency label so the check re-runs next cycle.
 */

const { resolveStatuses } = require('./config.js');
const { moveToStatusVerified } = require('./common/jiraHelpers.js');

function action(params) {
    const ticketKey = params.ticket && params.ticket.key;
    const customParams = params.jobParams && params.jobParams.customParams;
    const removeLabel = customParams && customParams.removeLabel;
    const statuses = resolveStatuses(customParams);

    function releaseLock() {
        if (ticketKey && removeLabel) {
            try {
                jira_remove_label({ key: ticketKey, label: removeLabel });
                console.log('Released SM label — will re-check next cycle');
            } catch (e) {
                console.warn('Failed to remove SM label:', e);
            }
        }
    }

    try {
        if (!ticketKey) throw new Error('params.ticket.key is missing');
        console.log('=== Bug To Fix ready check for', ticketKey, '===');

        // Step 1: Find all linked Bugs for this TC
        const linkedBugs = jira_search_by_jql({
            jql: 'issue in linkedIssues("' + ticketKey + '") AND issuetype = Bug',
            maxResults: 50
        }) || [];

        const totalBugs = linkedBugs.length;
        console.log('Linked Bugs:', totalBugs);

        if (totalBugs === 0) {
            console.log('No linked Bugs found — releasing lock, will re-check next cycle');
            releaseLock();
            return { success: true, action: 'no_linked_bugs', ticketKey };
        }

        // Step 2: Find linked Bugs NOT yet Done via JQL (more reliable than client-side field check)
        const notDoneBugs = jira_search_by_jql({
            jql: 'issue in linkedIssues("' + ticketKey + '") AND issuetype = Bug AND status != "Done"',
            maxResults: 1
        }) || [];

        const notDoneCount = notDoneBugs.length;
        console.log('Linked Bugs not yet Done:', notDoneCount, '/', totalBugs);

        if (notDoneCount > 0) {
            console.log('Not all linked Bugs are Done — releasing lock, will re-check next cycle');
            releaseLock();
            return { success: true, action: 'waiting', total: totalBugs, notDone: notDoneCount, ticketKey };
        }

        // All linked Bugs are Done → move TC back to the re-automation entry status.
        // Primary target is BACKLOG (configurable via customStatuses); fall back to
        // TODO for workflows that have no "Backlog" status (e.g. Simplified schemes) —
        // SM rule #19 scans Backlog / To Do / Ready For Development, so either re-enters
        // the automation pipeline. moveToStatusVerified re-reads the status, so a silent
        // no-op transition no longer strands the TC while reporting success.
        const reentryStatus = statuses.BACKLOG;
        console.log('All', totalBugs, 'linked Bug(s) are Done — moving', ticketKey, 'to', reentryStatus);

        const moveResult = moveToStatusVerified(
            ticketKey,
            reentryStatus,
            statuses.TODO,
            'all linked Bugs are Done → ready for re-automation'
        );

        if (!moveResult.moved) {
            // Transition genuinely unavailable in this workflow. The helper already posted
            // a loud alert; park the TC under the SM lock so we don't re-alert every cycle.
            // The stale-lock watchdog will retry after the TTL.
            console.error('❌', ticketKey, 'could not leave "Bug To Fix" — parking until workflow is fixed');
            try {
                jira_add_label({ key: ticketKey, label: 'sm_bug_to_fix_check_triggered' });
            } catch (e) { /* best-effort park */ }
            return { success: false, action: 'move_failed', status: moveResult.status, ticketKey };
        }

        // Remove test automation label so SM can re-trigger automation
        try {
            jira_remove_label({ key: ticketKey, label: 'sm_test_automation_triggered' });
            console.log('Removed sm_test_automation_triggered — TC will be re-automated next SM cycle');
        } catch (e) {
            console.warn('Failed to remove sm_test_automation_triggered label:', e);
        }

        releaseLock();

        jira_post_comment({
            key: ticketKey,
            comment: 'h3. 🔄 Test Case Ready for Re-automation\n\n' +
                'All *' + totalBugs + '* linked Bug(s) are now in *Done* status.\n\n' +
                'This Test Case has been automatically moved back to *' + moveResult.via + '* to be re-automated against the fixed code.'
        });

        console.log('✅ TC', ticketKey, 'moved to', moveResult.via);
        return { success: true, action: 'moved_to_backlog', movedTo: moveResult.via, totalBugs: totalBugs, ticketKey };

    } catch (error) {
        console.error('❌ Error in checkBugToFixReady:', error);
        releaseLock();
        return { success: false, error: error.toString() };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action };
}
