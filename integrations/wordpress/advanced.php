<?php
if (!defined('ABSPATH')) exit;
function orbit_identity_public_profile($identifier) {
    if (!preg_match('/^[a-z][a-z0-9_]{2,99}$/D', $identifier) || !orbit_identity_url()) return new WP_Error('orbit_invalid', 'Identity unavailable.');
    $response = wp_safe_remote_get(orbit_identity_url() . '/api/v1/profiles/' . rawurlencode($identifier), array('timeout' => 5, 'redirection' => 0, 'limit_response_size' => 2097152, 'headers' => array('Accept' => 'application/json')));
    if (is_wp_error($response)) return $response;
    if (wp_remote_retrieve_response_code($response) !== 200) return new WP_Error('orbit_unavailable', 'Identity unavailable.');
    $profile = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($profile) || empty($profile['id']) || !isset($profile['displayName'], $profile['handle'])) return new WP_Error('orbit_response', 'Invalid profile response.');
    // Never cache public profile fields across privacy changes.
    return $profile;
}
function orbit_identity_render_card($attributes = array()) {
    $identifier = isset($attributes['identifier']) ? sanitize_text_field($attributes['identifier']) : get_user_meta(get_the_author_meta('ID'), 'orbit_identity_identifier', true);
    if (!$identifier) return '';
    $profile = orbit_identity_public_profile($identifier);
    if (is_wp_error($profile)) return '';
    $url = orbit_identity_url() . '/u/' . rawurlencode($profile['handle']);
    $avatar = orbit_identity_url() . '/avatar/' . rawurlencode($profile['id']) . '?size=128&default=' . orbit_identity_fallback();
    return '<aside class="orbit-identity-author" aria-label="' . esc_attr__('Author profile', 'orbit-identity') . '"><a href="' . esc_url($url) . '" rel="me"><img src="' . esc_url($avatar) . '" alt="" width="64" height="64" loading="lazy"><strong>' . esc_html($profile['displayName']) . '</strong><span>@' . esc_html($profile['handle']) . '</span></a></aside>';
}
function orbit_identity_fallback() {
    $value = get_option('orbit_identity_fallback', 'geometric');
    return in_array($value, array('geometric', 'initials', 'rings', '404'), true) ? $value : 'geometric';
}
add_action('admin_init', function () {
    register_setting('orbit_identity', 'orbit_identity_fallback', array('type' => 'string', 'sanitize_callback' => function ($value) { return in_array($value, array('geometric', 'initials', 'rings', '404'), true) ? $value : 'geometric'; }));
    register_setting('orbit_identity', 'orbit_identity_author_box', array('type' => 'boolean', 'sanitize_callback' => 'rest_sanitize_boolean'));
    register_setting('orbit_identity', 'orbit_identity_local_fallback', array('type' => 'boolean', 'sanitize_callback' => 'rest_sanitize_boolean', 'default' => true));
});
add_filter('get_avatar_data', function ($args) {
    if (get_option('orbit_identity_local_fallback', true) && empty($args['orbit_identity_managed'])) {
        $args['url'] = plugins_url('fallback.svg', __FILE__);
        $args['found_avatar'] = false;
    }
    return $args;
}, 30);
add_filter('the_content', function ($content) {
    return get_option('orbit_identity_author_box', false) && is_singular() && in_the_loop() && is_main_query() ? $content . orbit_identity_render_card() : $content;
});
add_action('init', function () {
    wp_register_script('orbit-identity-block', plugins_url('block.js', __FILE__), array('wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components'), '1.0.0', true);
    register_block_type('orbit-identity/profile', array('api_version' => 3, 'editor_script' => 'orbit-identity-block', 'attributes' => array('identifier' => array('type' => 'string', 'default' => '')), 'render_callback' => 'orbit_identity_render_card'));
});
add_action('rest_api_init', function () {
    register_rest_route('orbit-identity/v1', '/profile/(?P<identifier>[a-z][a-z0-9_]{2,99})', array('methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => function ($request) {
        $profile = orbit_identity_public_profile($request['identifier']);
        if (is_wp_error($profile)) return new WP_Error('orbit_unavailable', 'Public identity unavailable.', array('status' => 404));
        $response = rest_ensure_response($profile);
        $response->header('Cache-Control', 'no-store');
        return $response;
    }));
    register_rest_route('orbit-identity/v1', '/users/(?P<id>\d+)/binding', array('methods' => 'POST', 'permission_callback' => function ($request) { return current_user_can('edit_user', (int)$request['id']); }, 'callback' => function ($request) {
        $identifier = sanitize_text_field((string)$request->get_param('identifier'));
        if ($identifier !== '' && !preg_match('/^[a-z][a-z0-9_]{2,99}$/D', $identifier)) return new WP_Error('orbit_invalid', 'Use a native handle or opaque ID.', array('status' => 400));
        update_user_meta((int)$request['id'], 'orbit_identity_identifier', $identifier);
        return rest_ensure_response(array('identifier' => $identifier));
    }));
});
if (defined('WP_CLI') && WP_CLI) {
    class Orbit_Identity_Command {
        /** Display a public profile. ## OPTIONS <identifier> */
        public function profile($args) {
            $profile = orbit_identity_public_profile($args[0]);
            if (is_wp_error($profile)) WP_CLI::error($profile->get_error_message());
            WP_CLI::line(wp_json_encode($profile, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }
        /** Bind a WordPress user. ## OPTIONS <user-id> <identifier> */
        public function bind($args) {
            $user = get_user_by('id', absint($args[0]));
            if (!$user || !preg_match('/^[a-z][a-z0-9_]{2,99}$/D', $args[1])) WP_CLI::error('Invalid user or native identifier.');
            update_user_meta($user->ID, 'orbit_identity_identifier', $args[1]);
            WP_CLI::success('Native identity bound. No email hash was sent.');
        }
        /** Remove a binding. ## OPTIONS <user-id> */
        public function unbind($args) { delete_user_meta(absint($args[0]), 'orbit_identity_identifier'); WP_CLI::success('Binding removed.'); }
    }
    WP_CLI::add_command('orbit identity', 'Orbit_Identity_Command');
}
add_filter('bp_core_fetch_avatar_url', function ($url, $params) {
    if (empty($params['object']) || $params['object'] !== 'user' || empty($params['item_id'])) return $url;
    $args = apply_filters('get_avatar_data', array('size' => isset($params['width']) ? $params['width'] : 96, 'url' => $url), (int)$params['item_id']);
    return $args['url'];
}, 20, 2);
