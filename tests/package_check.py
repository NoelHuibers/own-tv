"""The IPK the TV installs: layout, metadata, excluded files and reproducibility."""
import gzip
import io
import json
import sys
import tarfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from package import package  # noqa: E402


def ar_members(data):
    assert data.startswith(b'!<arch>\n'), 'not an ar archive'
    members, offset = {}, 8
    while offset < len(data):
        header = data[offset:offset + 60]
        name, size = header[:16].decode().strip().rstrip('/'), int(header[48:58])
        members[name] = data[offset + 60:offset + 60 + size]
        offset += 60 + size + size % 2
    return members


def tar_files(blob):
    with tarfile.open(fileobj=io.BytesIO(gzip.decompress(blob))) as tar:
        return {m.name.removeprefix('./'): tar.extractfile(m).read() for m in tar.getmembers() if m.isfile()}


class PackageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = package()
        cls.data = cls.path.read_bytes()
        cls.meta = json.loads((ROOT / 'app/appinfo.json').read_text())

    def test_name_and_ar_layout(self):
        self.assertEqual(self.path.name, f"{self.meta['id']}_{self.meta['version']}_all.ipk")
        self.assertEqual(list(ar_members(self.data)), ['debian-binary', 'control.tar.gz', 'data.tar.gz'])
        self.assertEqual(ar_members(self.data)['debian-binary'], b'2.0\n')

    def test_control_matches_appinfo(self):
        control = tar_files(ar_members(self.data)['control.tar.gz'])['control'].decode()
        self.assertIn(f"Package: {self.meta['id']}\n", control)
        self.assertIn(f"Version: {self.meta['version']}\n", control)

    def test_data_contains_app_and_nothing_private(self):
        files = tar_files(ar_members(self.data)['data.tar.gz'])
        base = f"usr/palm/applications/{self.meta['id']}/"
        for required in ['index.html', 'appinfo.json', 'app.js', 'bridge.js', 'styles.css', 'icon.png']:
            self.assertIn(base + required, files)
        self.assertEqual(json.loads(files[base + 'appinfo.json'])['version'], self.meta['version'])
        info = json.loads(files[f"usr/palm/packages/{self.meta['id']}/packageinfo.json"])
        self.assertEqual(info, {'id': self.meta['id'], 'version': self.meta['version'], 'app': self.meta['id']})
        for name in files:
            self.assertTrue(name.startswith((base, 'usr/palm/packages/')), name)
            self.assertFalse(Path(name).name in {'device.json', 'runtime.js'} or name.endswith(('.key', '.map')), name)
            self.assertFalse(any(part.startswith('.') for part in Path(name).parts), name)

    def test_build_is_reproducible(self):
        self.assertEqual(package().read_bytes(), self.data)


if __name__ == '__main__':
    unittest.main()
