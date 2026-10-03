# PHP SDK

PHP 8.1+ is required. Add this directory as a Composer path repository and require `orbit-identity/sdk`, or include `IdentityClient.php` directly. The package is prepared for Composer distribution.

```php
require 'vendor/autoload.php';
$client = new \OrbitIdentity\IdentityClient('https://identity.example.org');
$profile = $client->profile('alice');
foreach ($client->search('Alice') as $person) echo $person['handle'];
```

Pass a consent grant or OAuth token as the second argument. Use `consentedProfile()` for native grants, `oauthProfile()` for OAuth and `resolve(type, identifier)` for approved identifier adapters. HTTP failures carry status, apiCode and requestId. GETs have bounded timeouts and at most two retries on server errors. Redirects are rejected; TLS verification stays enabled. REST compatibility is 1.x. Never log bearer credentials or private response values.
