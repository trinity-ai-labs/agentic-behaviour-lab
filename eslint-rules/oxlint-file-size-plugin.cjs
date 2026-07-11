// File-size soft-limit rule for oxlint's `jsPlugins` (the JS-plugin bridge that
// lets oxlint run ESLint-shaped rule objects). Warns once a file passes the
// soft limit but before the hard limit that core `max-lines` errors on, so a
// growing file gets flagged while splitting it is still cheap. Counts physical
// lines, matching `wc -l`. `meta.name` = `file-size` to match the
// `file-size/soft-limit` rule id used in .oxlintrc.json.
const softLimit = {
  meta: {
    type: 'suggestion',
    schema: [
      {
        type: 'object',
        properties: { soft: { type: 'number' }, hard: { type: 'number' } },
        additionalProperties: false,
      },
    ],
    messages: {
      approaching:
        'File is {{count}} lines — past the {{soft}}-line soft limit (hard limit {{hard}}). Split it into cohesive modules before it grows further.',
    },
  },
  create(context) {
    const { soft = 600, hard = 800 } = context.options[0] ?? {};
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      'Program:exit'(node) {
        const count = sourceCode.lines.length;
        if (count > soft && count <= hard) {
          context.report({ node, messageId: 'approaching', data: { count, soft, hard } });
        }
      },
    };
  },
};

module.exports = {
  meta: { name: 'file-size' },
  rules: { 'soft-limit': softLimit },
};
