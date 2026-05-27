/**
 * Common Jira Helper Functions
 * Shared utilities for Jira ticket operations
 */

const { STATUSES, LABELS } = require('../config.js');

/**
 * Assign ticket to initiator and move to "In Review" status with AI-generated label
 * This is the common post-processing logic used by multiple agents
 * 
 * @param {string} ticketKey - The Jira ticket key
 * @param {string} initiatorId - Account ID of the person to assign the ticket to
 * @param {string} wipLabel - Optional WIP label to remove after processing
 * @returns {Object} Result object with success status and message
 */
function assignForReview(ticketKey, initiatorId, wipLabel, targetStatus) {
    const statusName = targetStatus || STATUSES.IN_REVIEW;
    try {
        console.log("Processing ticket:", ticketKey);

        // Assign to initiator
        jira_assign_ticket_to({
            key: ticketKey,
            accountId: initiatorId
        });

        // Move to target status
        jira_move_to_status({
            key: ticketKey,
            statusName: statusName
        });

        // Add AI-generated label
        jira_add_label({
            key: ticketKey,
            label: LABELS.AI_GENERATED
        });

        // Remove WIP label if provided
        if (wipLabel) {
            try {
                jira_remove_label({
                    key: ticketKey,
                    label: wipLabel
                });
                console.log('Removed WIP label "' + wipLabel + '" from ' + ticketKey);
            } catch (labelError) {
                console.warn('Failed to remove WIP label "' + wipLabel + '":', labelError);
            }
        }

        console.log('✅ Assigned to initiator and moved to ' + statusName);

        return {
            success: true,
            message: 'Ticket ' + ticketKey + ' assigned and moved to ' + statusName
        };

    } catch (error) {
        console.error("❌ Error in assignForReview:", error);
        return {
            success: false,
            error: error.toString()
        };
    }
}

/**
 * Extract ticket key from Jira API response
 * 
 * @param {string|Object} result - Jira API response
 * @returns {string|null} Extracted ticket key or null if not found
 */
function extractTicketKey(result) {
    if (!result) {
        return null;
    }
    if (typeof result === 'string') {
        try {
            const parsed = JSON.parse(result);
            return parsed && parsed.key ? parsed.key : null;
        } catch (error) {
            return null;
        }
    }
    if (typeof result === 'object' && typeof result.key === 'string') {
        return result.key;
    }
    return null;
}

/**
 * Set priority on a Jira ticket using the appropriate API
 * 
 * @param {string} ticketKey - The Jira ticket key
 * @param {string} priority - Priority name (e.g., 'Low', 'Medium', 'High')
 * @returns {boolean} True if successful, false otherwise
 */
function setTicketPriority(ticketKey, priority) {
    if (!ticketKey || !priority) {
        return false;
    }
    
    try {
        jira_set_priority({
            key: ticketKey,
            priority: priority
        });
        console.log('Set priority ' + priority + ' on ticket ' + ticketKey);
        return true;
    } catch (priorityError) {
        console.error('Failed to set priority on ticket ' + ticketKey + ':', priorityError);
        return false;
    }
}

/**
 * Release SM idempotency labels so the next SM tick can retry the rule.
 * Called from setup-scripts (preCli*) on TRANSIENT errors (git, network) where
 * a retry is desired. Do NOT call for permanent failures (no PR, branch missing,
 * etc.) — those would cause SM to loop and spam Jira comments.
 *
 * @param {string} ticketKey - Jira ticket key
 * @param {Object} customParams - agent customParams (reads removeLabel/removeLabels)
 */
function releaseSmLock(ticketKey, customParams) {
    if (!ticketKey || !customParams) return;
    var labels = [];
    if (customParams.removeLabel) labels.push(customParams.removeLabel);
    if (Array.isArray(customParams.removeLabels)) {
        customParams.removeLabels.forEach(function(l) { if (l) labels.push(l); });
    }
    labels.forEach(function(label) {
        try {
            jira_remove_label({ key: ticketKey, label: label });
            console.log('  Released SM lock label: ' + label);
        } catch (e) {
            console.warn('  Failed to release SM lock label ' + label + ': ' + (e && e.message || e));
        }
    });
}

/**
 * Move ticket to a target status, posting a loud Jira comment on failure
 * (instead of silent console.warn). Used after PR creation / rework push where
 * a missed transition would silently strand the ticket and confuse SM rules.
 *
 * @param {string} ticketKey - Jira ticket key
 * @param {string} statusName - Target status name
 * @param {string} [contextLabel] - Optional human label for comment ("after PR creation")
 * @returns {boolean} true on success, false on failure (comment already posted)
 */
function moveStatusOrAlert(ticketKey, statusName, contextLabel) {
    try {
        jira_move_to_status({ key: ticketKey, statusName: statusName });
        console.log('✅ Moved ' + ticketKey + ' to ' + statusName);
        return true;
    } catch (error) {
        var msg = (error && error.message) || String(error);
        console.error('❌ Failed to move ' + ticketKey + ' to ' + statusName + ': ' + msg);
        try {
            jira_post_comment({
                key: ticketKey,
                comment: 'h3. ⚠️ Status Transition Failed\n\n' +
                    'Could not move ticket to *' + statusName + '*' +
                    (contextLabel ? ' (' + contextLabel + ')' : '') + '.\n\n' +
                    'Jira workflow may not allow this transition from the current status. ' +
                    'Please move the ticket manually so the SM pipeline can pick it up.\n\n' +
                    '{code}' + msg + '{code}'
            });
        } catch (e) {}
        return false;
    }
}

/**
 * Confirm (via JQL) that a ticket is currently in a given status.
 *
 * Uses jira_search_by_jql rather than jira_get_ticket on purpose: DMTools'
 * BasicJiraClient caches GET-by-key responses, and the SM executor fetches the
 * ticket before running a postJS action, so a jira_get_ticket right after a move
 * returns the stale pre-move status within the same run. A status-scoped JQL is a
 * fresh query that reflects server truth.
 *
 * @param {string} ticketKey
 * @param {string} statusName
 * @returns {boolean}
 */
function isInStatus(ticketKey, statusName) {
    try {
        var hits = jira_search_by_jql({
            jql: 'key = ' + ticketKey + ' AND status = "' + statusName + '"',
            maxResults: 1
        }) || [];
        return hits.length > 0;
    } catch (e) {
        return false;
    }
}

/**
 * Move a ticket to a target status and VERIFY (via JQL) the transition happened.
 *
 * jira_move_to_status can silently no-op (without throwing) when the target
 * status/transition does not exist in the project's Jira workflow — e.g. a
 * "Simplified" workflow that has no "Backlog" status. A silent no-op would strand
 * the ticket and make the SM rule loop forever while reporting success. This helper
 * verifies the move and, if it did not take, retries with fallbackStatus. It posts
 * no comments — the caller decides how to react to moved:false.
 *
 * @param {string} ticketKey
 * @param {string} targetStatus     - preferred status name (transition name in this Jira)
 * @param {string} [fallbackStatus] - tried if targetStatus is absent from the workflow
 * @returns {{ moved: boolean, via: (string|null) }}
 */
function moveToStatusVerified(ticketKey, targetStatus, fallbackStatus) {
    var candidates = [targetStatus];
    if (fallbackStatus && fallbackStatus !== targetStatus) candidates.push(fallbackStatus);

    for (var i = 0; i < candidates.length; i++) {
        var target = candidates[i];
        try {
            jira_move_to_status({ key: ticketKey, statusName: target });
        } catch (e) {
            console.warn('  move ' + ticketKey + ' -> ' + target + ' threw: ' + ((e && e.message) || e));
        }

        if (isInStatus(ticketKey, target)) {
            console.log('Moved ' + ticketKey + ' to ' + target + (i > 0 ? ' (fallback)' : ''));
            return { moved: true, via: target };
        }

        console.warn('  ' + ticketKey + ' not confirmed in "' + target + '"' +
            (i + 1 < candidates.length ? ' - trying fallback "' + candidates[i + 1] + '"' : ''));
    }

    return { moved: false, via: null };
}

// Export functions for use by other modules
module.exports = {
    assignForReview,
    extractTicketKey,
    setTicketPriority,
    releaseSmLock,
    moveStatusOrAlert,
    isInStatus,
    moveToStatusVerified
};

