(function (wp) {
  const el = wp.element.createElement;
  wp.blocks.registerBlockType('orbit-identity/profile', {
    apiVersion: 3, title: 'Orbit public profile', icon: 'admin-users', category: 'widgets',
    attributes: { identifier: { type: 'string', default: '' } },
    edit: function (props) {
      return el('div', wp.blockEditor.useBlockProps(), el(wp.components.TextControl, {
        label: 'Native identity handle or ID', value: props.attributes.identifier,
        onChange: function (value) { props.setAttributes({ identifier: value }); },
        help: 'Leave empty to use the post author’s binding. Published fields are fetched when the page is rendered.'
      }));
    },
    save: function () { return null; }
  });
})(window.wp);
