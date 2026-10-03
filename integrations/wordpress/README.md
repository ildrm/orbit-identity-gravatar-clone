# Orbit Identity for WordPress

Copy this whole directory into wp-content/plugins/orbit-identity and activate the plugin. Configure an HTTPS Orbit origin in Settings → Orbit Identity, then add a native handle or opaque identity ID to a WordPress user profile. No email address or email hash is sent to Orbit.

The plugin integrates comment and user avatars, post authors, an optional automatic author box, the “Orbit public profile” Gutenberg block, WooCommerce's standard WordPress avatar calls, and BuddyPress user avatars when BuddyPress is present. Unbound visitors use a local generic avatar by default. Administrators can explicitly enable their site's existing fallback behavior or select Orbit's geometric, initials, rings or 404 fallback.

REST: GET /wp-json/orbit-identity/v1/profile/{identifier} fetches the current public projection with no caching. POST /wp-json/orbit-identity/v1/users/{id}/binding requires edit_user permission and WordPress REST authentication/nonce. Fields are escaped during rendering; unavailable or private profiles produce no author card.

WP-CLI: wp orbit identity profile HANDLE, wp orbit identity bind USER_ID HANDLE, wp orbit identity unbind USER_ID. Requests use WordPress safe HTTPS transport with a five-second timeout, redirect refusal and a two-MiB response bound. Server-side page caches must exclude dynamic author cards if immediate changes to profile privacy are required.
