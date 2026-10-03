<?php
declare(strict_types=1);

namespace OrbitIdentity;

final class ApiException extends \RuntimeException
{
    public function __construct(public readonly int $status, public readonly string $apiCode, public readonly string $requestId, string $message)
    {
        parent::__construct($message);
    }
}

final class IdentityClient
{
    private string $origin;
    public function __construct(string $origin, private ?string $token = null, private int $timeout = 5)
    {
        $url = parse_url($origin);
        if (!is_array($url) || isset($url['user']) || isset($url['pass']) || !isset($url['host'], $url['scheme']) ||
            ($url['scheme'] !== 'https' && !($url['scheme'] === 'http' && in_array($url['host'], ['localhost', '127.0.0.1'], true)))) {
            throw new \InvalidArgumentException('Use HTTPS or a loopback development origin');
        }
        if ($timeout < 1 || $timeout > 60) throw new \InvalidArgumentException('Timeout must be between one and sixty seconds');
        $this->origin = $url['scheme'] . '://' . $url['host'] . (isset($url['port']) ? ':' . $url['port'] : '');
    }

    public function request(string $path): array
    {
        if (!str_starts_with($path, '/') || strlen($path) > 4096 || str_contains($path, "\r") || str_contains($path, "\n")) throw new \InvalidArgumentException('Use an API-relative path');
        $headers = "Accept: application/json\r\n";
        if ($this->token !== null) {
            if (!preg_match('/^[A-Za-z0-9_-]+$/D', $this->token)) throw new \InvalidArgumentException('Invalid token');
            $headers .= "Authorization: Bearer " . $this->token . "\r\n";
        }
        for ($attempt = 0; $attempt < 3; $attempt++) {
            $context = stream_context_create(['http' => ['timeout' => $this->timeout, 'header' => $headers, 'ignore_errors' => true, 'follow_location' => 0], 'ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
            $stream = @fopen($this->origin . '/api/v1' . $path, 'rb', false, $context);
            if ($stream === false) throw new ApiException(0, 'TRANSPORT_ERROR', '', 'Connection unavailable');
            $body = stream_get_contents($stream, 2_097_153);
            $metadata = stream_get_meta_data($stream);
            fclose($stream);
            if (!empty($metadata['timed_out'])) throw new ApiException(0, 'TIMEOUT', '', 'Request timed out');
            if ($body === false || strlen($body) > 2_097_152) throw new ApiException(0, 'RESPONSE_TOO_LARGE', '', 'Response exceeds two MiB');
            $status = 0;
            foreach ($metadata['wrapper_data'] ?? [] as $line) {
                if (preg_match('/^HTTP\/\S+\s+(\d+)/', $line, $match)) $status = (int)$match[1];
            }
            if ($status >= 500 && $attempt < 2) { usleep(100_000 * (2 ** $attempt)); continue; }
            try { $data = json_decode((string)$body, true, 512, JSON_THROW_ON_ERROR); } catch (\JsonException $error) { throw new ApiException($status, 'INVALID_RESPONSE', '', 'Invalid JSON response'); }
            if (!is_array($data)) throw new ApiException($status, 'INVALID_RESPONSE', '', 'Invalid JSON response');
            if ($status < 200 || $status >= 300) throw new ApiException($status, $data['code'] ?? $data['error'] ?? 'REQUEST_FAILED', $data['request_id'] ?? '', $data['message'] ?? $data['error_description'] ?? 'Request failed');
            return $data;
        }
        throw new \RuntimeException('Request exhausted retries');
    }

    public function profile(string $identifier, ?string $persona = null): array
    {
        return $this->request('/profiles/' . rawurlencode($identifier) . ($persona !== null ? '?persona=' . rawurlencode($persona) : ''));
    }

    public function resolve(string $type, string $identifier): array
    {
        if (!in_array($type, ['native', 'domain', 'email', 'github', 'did'], true)) throw new \InvalidArgumentException('Unsupported resolver type');
        return $this->request('/resolve?' . http_build_query(['type' => $type, 'identifier' => $identifier]));
    }

    public function oauthProfile(): array { return $this->request('/oauth/profile'); }
    public function oauthCredentials(): array { return $this->request('/oauth/credentials'); }

    public function consentedProfile(): array { return $this->request('/application/profile'); }

    public function search(string $term): \Generator
    {
        $cursor = ''; $seen = [];
        do {
            $page = $this->request('/search?' . http_build_query(['q' => $term, 'cursor' => $cursor]));
            foreach ($page['items'] as $item) yield $item;
            $cursor = $page['nextCursor'];
            if ($cursor !== null) { if (isset($seen[$cursor])) throw new ApiException(0, 'INVALID_CURSOR', '', 'Repeated pagination cursor'); $seen[$cursor] = true; }
        } while ($cursor !== null);
    }
}
