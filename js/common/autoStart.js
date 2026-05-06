var scmModule = require('./scm.js');

function deriveProjectKey(customParams) {
    if (!customParams) return '';
    if (customParams.projectKey) return customParams.projectKey;
    var cp = customParams.configPath || '';
    if (!cp) return '';
    var base = cp.substring(cp.lastIndexOf('/') + 1).replace(/\.js$/, '');
    return (base && base !== 'config') ? base : '';
}

function buildAutoStartEncodedConfig(ticketKey, customParams, stripKeys) {
    var p = { inputJql: 'key = ' + ticketKey };

    if (customParams) {
        var nextCustomParams = Object.assign({}, customParams);
        (stripKeys || []).forEach(function(key) {
            delete nextCustomParams[key];
        });
        if (Object.keys(nextCustomParams).length > 0) {
            p.customParams = nextCustomParams;
        }
    }

    return encodeURIComponent(JSON.stringify({ params: p }));
}

function triggerConfiguredWorkflowForTicket(options) {
    var ticketKey = options.ticketKey;
    var customParams = options.customParams || {};
    var config = options.config || {};
    var configFile = options.configFile;
    var workflowFile = options.workflowFile || 'ai-teammate.yml';
    var ref = options.ref || 'main';
    var label = options.label || configFile || workflowFile;
    var stripKeys = options.stripKeys || [];

    if (!ticketKey || !configFile) {
        console.warn('autoStart: missing ticketKey or configFile — skipping');
        return false;
    }

    var aiRepoCfg = customParams.aiRepository;
    var aiOwner = (aiRepoCfg && aiRepoCfg.owner) || (config.repository && config.repository.owner);
    var aiRepo = (aiRepoCfg && aiRepoCfg.repo) || (config.repository && config.repository.repo);

    if (!aiOwner || !aiRepo) {
        console.warn('autoStart: config.repository.owner/repo not set — skipping');
        return false;
    }

    var scm = options.scm || scmModule.createScm(config);
    var projectKey = deriveProjectKey(customParams);
    var encodedCfg = buildAutoStartEncodedConfig(ticketKey, customParams, stripKeys);

    scm.triggerWorkflow(
        aiOwner,
        aiRepo,
        workflowFile,
        JSON.stringify({
            concurrency_key: ticketKey,
            config_file: configFile,
            encoded_config: encodedCfg,
            project_key: projectKey || ''
        }),
        ref
    );

    console.log('✅ Auto-started ' + label + ' for ' + ticketKey +
        ' [config=' + configFile + (projectKey ? ', project=' + projectKey : '') + ']');
    return true;
}

module.exports = {
    deriveProjectKey: deriveProjectKey,
    buildAutoStartEncodedConfig: buildAutoStartEncodedConfig,
    triggerConfiguredWorkflowForTicket: triggerConfiguredWorkflowForTicket
};
