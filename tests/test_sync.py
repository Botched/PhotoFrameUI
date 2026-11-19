import json
import os
import stat
import tempfile
import unittest
from unittest import mock

import app as appmod

NS = '/frame'


class TempEnvTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        root = self._tmp.name
        self.data_dir = os.path.join(root, 'data')
        self.upload_dir = os.path.join(root, 'uploads')
        self.thumb_dir = os.path.join(root, 'thumbs')
        for d in (self.data_dir, self.upload_dir, self.thumb_dir):
            os.makedirs(d)
        self.settings_file = os.path.join(self.data_dir, 'settings.json')
        self.meta_file = os.path.join(self.data_dir, 'photos.json')

        patches = [
            mock.patch.object(appmod, 'SETTINGS_FILE', self.settings_file),
            mock.patch.object(appmod, 'PHOTOS_META_FILE', self.meta_file),
            mock.patch.dict(appmod.app.config, {
                'UPLOAD_FOLDER': self.upload_dir,
                'THUMBNAIL_FOLDER': self.thumb_dir,
                'DATA_FOLDER': self.data_dir,
            }),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

        self.http = appmod.app.test_client()

    def add_photo(self, rel):
        path = os.path.join(self.upload_dir, *rel.split('/'))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(b'x')
        return path

    def socket_client(self):
        client = appmod.socketio.test_client(appmod.app, namespace=NS)
        self.addCleanup(client.disconnect, namespace=NS)
        client.get_received(NS)
        return client

    @staticmethod
    def names(received):
        return [m['name'] for m in received]

    def read_meta_bytes(self):
        with open(self.meta_file, 'rb') as f:
            return f.read()


class SyncPhotosTests(TempEnvTestCase):
    def test_unchanged_folder_no_write_no_broadcast(self):
        self.add_photo('a.jpg')
        self.add_photo('sub/b.png')
        appmod.sync_photos()
        before = self.read_meta_bytes()
        client = self.socket_client()
        with mock.patch.object(appmod, 'save_photos_meta', wraps=appmod.save_photos_meta) as save, \
                mock.patch.object(appmod, 'broadcast_update', wraps=appmod.broadcast_update) as bc:
            meta = appmod.sync_photos()
        self.assertEqual(save.call_count, 0)
        self.assertEqual(bc.call_count, 0)
        self.assertEqual(self.read_meta_bytes(), before)
        self.assertEqual(set(meta), {'a.jpg', 'sub/b.png'})
        self.assertNotIn('photos_changed', self.names(client.get_received(NS)))

    def test_added_file_one_write_one_broadcast(self):
        self.add_photo('a.jpg')
        appmod.sync_photos()
        self.add_photo('c.jpg')
        client = self.socket_client()
        with mock.patch.object(appmod, 'save_photos_meta', wraps=appmod.save_photos_meta) as save:
            meta = appmod.sync_photos()
        self.assertEqual(save.call_count, 1)
        self.assertIn('c.jpg', meta)
        events = self.names(client.get_received(NS))
        self.assertEqual(events.count('photos_changed'), 1)

    def test_removed_file_one_write_one_broadcast(self):
        p = self.add_photo('a.jpg')
        self.add_photo('b.jpg')
        appmod.sync_photos()
        os.remove(p)
        client = self.socket_client()
        with mock.patch.object(appmod, 'save_photos_meta', wraps=appmod.save_photos_meta) as save:
            meta = appmod.sync_photos()
        self.assertEqual(save.call_count, 1)
        self.assertNotIn('a.jpg', meta)
        events = self.names(client.get_received(NS))
        self.assertEqual(events.count('photos_changed'), 1)


class ReadsDoNotWriteTests(TempEnvTestCase):
    def setUp(self):
        super().setUp()
        self.add_photo('a.jpg')
        self.add_photo('d/b.jpg')
        appmod.sync_photos()
        self.before = self.read_meta_bytes()

    def test_request_sync_repeated(self):
        client = self.socket_client()
        with mock.patch.object(appmod, 'save_photos_meta', wraps=appmod.save_photos_meta) as save:
            for _ in range(10):
                client.emit('request_sync', namespace=NS)
        self.assertEqual(save.call_count, 0)
        received = client.get_received(NS)
        names = self.names(received)
        self.assertNotIn('photos_changed', names)
        self.assertEqual(names.count('full_sync'), 10)
        payload = [m for m in received if m['name'] == 'full_sync'][0]['args'][0]
        self.assertEqual({p['filename'] for p in payload['photos']}, {'a.jpg', 'd/b.jpg'})
        self.assertEqual(self.read_meta_bytes(), self.before)

    def test_get_api_photos_repeated(self):
        client = self.socket_client()
        with mock.patch.object(appmod, 'save_photos_meta', wraps=appmod.save_photos_meta) as save:
            for _ in range(10):
                resp = self.http.get('/api/photos')
                self.assertEqual(resp.status_code, 200)
                self.assertEqual(len(resp.get_json()), 2)
        self.assertEqual(save.call_count, 0)
        self.assertNotIn('photos_changed', self.names(client.get_received(NS)))
        self.assertEqual(self.read_meta_bytes(), self.before)

    def test_simulated_loop_reaches_fixed_point(self):
        client = self.socket_client()
        total_changed = 0
        # Round 0: a real change (new file), then client answers like frame.js.
        self.add_photo('new.jpg')
        client.emit('request_sync', namespace=NS)
        for _ in range(20):
            received = client.get_received(NS)
            changed = self.names(received).count('photos_changed')
            total_changed += changed
            if not changed:
                break
            client.emit('request_sync', namespace=NS)
        else:
            self.fail('did not reach a fixed point in 20 rounds')
        self.assertLessEqual(total_changed, 1)
        # Nothing further after fixed point.
        client.emit('request_sync', namespace=NS)
        self.assertNotIn('photos_changed', self.names(client.get_received(NS)))


class AtomicSaveTests(TempEnvTestCase):
    def dir_files(self):
        return sorted(os.listdir(self.data_dir))

    def test_save_photos_meta_valid_and_no_temp(self):
        meta = {'a.jpg': {'filename': 'a.jpg', 'folder': '.', 'active': True, 'added': 1.5}}
        appmod.save_photos_meta(meta)
        with open(self.meta_file) as f:
            self.assertEqual(json.load(f), meta)
        self.assertEqual(self.dir_files(), ['photos.json'])

    def test_save_settings_valid_and_no_temp(self):
        settings = {'rotation_speed': 7, 'transition': 'fade'}
        appmod.save_settings(settings)
        with open(self.settings_file) as f:
            self.assertEqual(json.load(f), settings)
        self.assertEqual(self.dir_files(), ['settings.json'])

    def _failure_case(self, save, path, original):
        with open(path, 'w') as f:
            json.dump(original, f)
        with open(path, 'rb') as f:
            before = f.read()
        client = self.socket_client()
        with mock.patch.object(appmod.json, 'dump', side_effect=RuntimeError('boom')):
            with self.assertRaises(RuntimeError):
                save({'new': 'data'})
        with open(path, 'rb') as f:
            self.assertEqual(f.read(), before)
        self.assertEqual(self.dir_files(), [os.path.basename(path)])
        self.assertEqual(client.get_received(NS), [])

    def test_failed_meta_write_leaves_original(self):
        self._failure_case(appmod.save_photos_meta, self.meta_file, {'old': 1})

    def test_failed_settings_write_leaves_original(self):
        self._failure_case(appmod.save_settings, self.settings_file, {'old': 1})

    def test_uses_replace_and_fsync(self):
        with mock.patch.object(appmod.os, 'replace', wraps=os.replace) as rep, \
                mock.patch.object(appmod.os, 'fsync', wraps=os.fsync) as fs:
            appmod.save_photos_meta({})
        self.assertEqual(rep.call_count, 1)
        self.assertEqual(fs.call_count, 1)
        self.assertEqual(os.path.dirname(os.path.abspath(rep.call_args[0][0])),
                         os.path.dirname(os.path.abspath(self.meta_file)))

    @staticmethod
    def current_umask():
        old = os.umask(0)
        os.umask(old)
        return old

    @unittest.skipIf(os.name == 'nt', 'exact POSIX permission bits not honoured on Windows')
    def test_existing_file_mode_preserved(self):
        with open(self.meta_file, 'w') as f:
            json.dump({'old': 1}, f)
        os.chmod(self.meta_file, 0o644)
        appmod.save_photos_meta({'new': 2})
        self.assertEqual(stat.S_IMODE(os.stat(self.meta_file).st_mode), 0o644)

    @unittest.skipIf(os.name == 'nt', 'exact POSIX permission bits not honoured on Windows')
    def test_new_file_mode_follows_umask(self):
        self.assertFalse(os.path.exists(self.meta_file))
        appmod.save_photos_meta({'new': 2})
        expected = 0o666 & ~self.current_umask()
        self.assertEqual(stat.S_IMODE(os.stat(self.meta_file).st_mode), expected)

    def _chmod_calls(self):
        calls = []
        real_chmod, real_replace = os.chmod, os.replace

        def chmod(path, mode, *a, **k):
            calls.append(('chmod', path, mode))
            return real_chmod(path, mode, *a, **k)

        def replace(src, dst, *a, **k):
            calls.append(('replace', src, dst))
            return real_replace(src, dst, *a, **k)

        return calls, chmod, replace

    def _assert_chmod_before_replace(self, expected_mode):
        calls, chmod, replace = self._chmod_calls()
        with mock.patch.object(appmod.os, 'chmod', side_effect=chmod),                 mock.patch.object(appmod.os, 'replace', side_effect=replace):
            appmod.save_photos_meta({'new': 2})
        kinds = [c[0] for c in calls]
        self.assertEqual(kinds, ['chmod', 'replace'])
        self.assertEqual(calls[0][1], calls[1][1])  # chmod on the temp path
        self.assertNotEqual(calls[0][1], self.meta_file)
        self.assertEqual(calls[0][2], expected_mode)

    def test_chmod_temp_before_replace_existing(self):
        with open(self.meta_file, 'w') as f:
            json.dump({'old': 1}, f)
        expected = stat.S_IMODE(os.stat(self.meta_file).st_mode)
        self._assert_chmod_before_replace(expected)

    def test_chmod_temp_before_replace_new(self):
        self._assert_chmod_before_replace(0o666 & ~self.current_umask())

    def test_chmod_failure_cleans_up_and_keeps_original(self):
        with open(self.meta_file, 'w') as f:
            json.dump({'old': 1}, f)
        with open(self.meta_file, 'rb') as f:
            before = f.read()
        with mock.patch.object(appmod.os, 'chmod', side_effect=PermissionError('no')):
            with self.assertRaises(PermissionError):
                appmod.save_photos_meta({'new': 2})
        with open(self.meta_file, 'rb') as f:
            self.assertEqual(f.read(), before)
        self.assertEqual(self.dir_files(), ['photos.json'])


class ToggleTests(TempEnvTestCase):
    def setUp(self):
        super().setUp()
        self.add_photo('a.jpg')
        self.add_photo('d/b.jpg')
        appmod.sync_photos()

    def test_photo_toggle_one_write_one_broadcast(self):
        client = self.socket_client()
        with mock.patch.object(appmod, 'save_photos_meta', wraps=appmod.save_photos_meta) as save:
            resp = self.http.post('/api/photo/toggle/a.jpg')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.get_json()['active'])
        self.assertEqual(save.call_count, 1)
        self.assertEqual(self.names(client.get_received(NS)).count('photos_changed'), 1)

    def test_folder_toggle_one_write_one_broadcast(self):
        client = self.socket_client()
        with mock.patch.object(appmod, 'save_photos_meta', wraps=appmod.save_photos_meta) as save:
            resp = self.http.post('/api/folder/toggle', json={'folder': 'd', 'active': False})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(save.call_count, 1)
        self.assertEqual(self.names(client.get_received(NS)).count('photos_changed'), 1)
        with open(self.meta_file) as f:
            meta = json.load(f)
        self.assertFalse(meta['d/b.jpg']['active'])
        self.assertTrue(meta['a.jpg']['active'])


if __name__ == '__main__':
    unittest.main()
