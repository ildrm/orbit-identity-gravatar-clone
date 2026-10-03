import unittest
from orbit_identity import IdentityClient


class ClientValidationTest(unittest.TestCase):
    def test_unsafe_origin_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            IdentityClient(origin="http://example.com")
        with self.assertRaises(ValueError):
            IdentityClient(origin="https://user:password@example.com")

    def test_base_url_discards_path_and_query(self) -> None:
        client = IdentityClient(origin="https://example.com/path?token=secret")
        self.assertEqual(client.origin, "https://example.com")


if __name__ == "__main__":
    unittest.main()
