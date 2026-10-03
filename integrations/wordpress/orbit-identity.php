<?php
/**
 * Plugin Name: Orbit Identity
 * Description: Native identity avatars for WordPress users, authors and comments. No public email hashes.
 * Version: 1.0.0
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * License: GPL-2.0-or-later
 */
if (!defined('ABSPATH')) exit;

function orbit_identity_url() {
    $url = esc_url_raw(get_option('orbit_identity_origin', ''), array('https'));
    return rtrim($url, '/');
}
add_action('admin_menu', function () {
    add_options_page('Orbit Identity', 'Orbit Identity', 'manage_options', 'orbit-identity', 'orbit_identity_settings');
});
add_action('admin_init', function () {
    register_setting('orbit_identity', 'orbit_identity_origin', array('type' => 'string', 'sanitize_callback' => function ($value) {
        $url = esc_url_raw($value, array('https'));
        return wp_http_validate_url($url) ? rtrim($url, '/') : '';
    }));
});
function orbit_identity_settings() {
    if (!current_user_can('manage_options')) return;
    echo '<div class="wrap"><h1>Orbit Identity</h1><p>Set an HTTPS instance URL. Users can set a native handle or opaque identity ID on their WordPress profile.</p><form method="post" action="options.php">';
    settings_fields('orbit_identity');
    echo '<label for="orbit-origin">Instance URL</label> <input id="orbit-origin" name="orbit_identity_origin" type="url" value="' . esc_attr(get_option('orbit_identity_origin', '')) . '" placeholder="https://identity.example.com">';
    echo '<p><label>Orbit fallback <select name="orbit_identity_fallback">';
    foreach (array('geometric', 'initials', 'rings', '404') as $style) echo '<option value="' . esc_attr($style) . '" ' . selected(orbit_identity_fallback(), $style, false) . '>' . esc_html($style) . '</option>';
    echo '</select></label></p><p><input type="hidden" name="orbit_identity_local_fallback" value="0"><label><input type="checkbox" name="orbit_identity_local_fallback" value="1" ' . checked(get_option('orbit_identity_local_fallback', true), true, false) . '> Use a local fallback for unbound users</label></p><p><input type="hidden" name="orbit_identity_author_box" value="0"><label><input type="checkbox" name="orbit_identity_author_box" value="1" ' . checked(get_option('orbit_identity_author_box', false), true, false) . '> Show an author profile box after posts</label></p>';
    submit_button();
    echo '</form></div>';
}
function orbit_identity_profile_field($user) {
    if (!current_user_can('edit_user', $user->ID)) return;
    wp_nonce_field('orbit_identity_profile', 'orbit_identity_nonce');
    echo '<h2>Orbit Identity</h2><table class="form-table"><tr><th><label for="orbit-identifier">Identity handle or ID</label></th><td><input id="orbit-identifier" name="orbit_identity_identifier" value="' . esc_attr(get_user_meta($user->ID, 'orbit_identity_identifier', true)) . '"><p class="description">A native handle or opaque ID. Email hashes are not supported.</p></td></tr></table>';
}
add_action('show_user_profile', 'orbit_identity_profile_field');
add_action('edit_user_profile', 'orbit_identity_profile_field');
function orbit_identity_save_profile($user_id) {
    if (!current_user_can('edit_user', $user_id) || !isset($_POST['orbit_identity_nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['orbit_identity_nonce'])), 'orbit_identity_profile')) return;
    $value = isset($_POST['orbit_identity_identifier']) ? sanitize_text_field(wp_unslash($_POST['orbit_identity_identifier'])) : '';
    if ($value === '' || preg_match('/^[a-z][a-z0-9_]{2,99}$/D', $value)) update_user_meta($user_id, 'orbit_identity_identifier', $value);
}
add_action('personal_options_update', 'orbit_identity_save_profile');
add_action('edit_user_profile_update', 'orbit_identity_save_profile');
add_filter('get_avatar_data', function ($args, $id_or_email) {
    $origin = orbit_identity_url();
    if (!$origin) return $args;
    $user_id = 0;
    if (is_numeric($id_or_email)) $user_id = absint($id_or_email);
    elseif ($id_or_email instanceof WP_User) $user_id = $id_or_email->ID;
    elseif ($id_or_email instanceof WP_Comment) $user_id = (int)$id_or_email->user_id;
    elseif ($id_or_email instanceof WP_Post) $user_id = (int)$id_or_email->post_author;
    elseif (is_string($id_or_email) && is_email($id_or_email)) { $user = get_user_by('email', $id_or_email); if ($user) $user_id = $user->ID; }
    if (!$user_id) return $args;
    $identifier = get_user_meta($user_id, 'orbit_identity_identifier', true);
    if (!$identifier || !preg_match('/^[a-z][a-z0-9_]{2,99}$/D', $identifier)) return $args;
    $size = min(1024, max(16, absint($args['size'])));
    $args['url'] = esc_url($origin . '/avatar/' . rawurlencode($identifier) . '?size=' . $size . '&default=' . orbit_identity_fallback());
    $args['found_avatar'] = true;
    $args['orbit_identity_managed'] = true;
    return apply_filters('orbit_identity_avatar_data', $args, $user_id, $identifier);
}, 20, 2);
require_once __DIR__ . '/advanced.php';
