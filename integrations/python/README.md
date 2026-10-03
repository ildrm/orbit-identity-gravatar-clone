# Python client

Install from this directory with `python -m pip install .`. The client uses Python 3.11+ standard-library HTTPS, bounded deadlines, GET-only retries, typed API errors and cursor iteration. No third-party runtime dependency is required.

```python
from orbit_identity import IdentityClient, IdentityApiError
client = IdentityClient(origin="https://identity.example.org")
profile = client.profile(identifier="alice")
for person in client.search(term="Alice"):
    print(person["handle"])
```

An explicitly granted bearer token can be supplied with `token=`. Native grants use `consented_profile`; OAuth access uses `oauth_profile`. This client targets REST 1.x. Keep credentials and private responses out of logs.
