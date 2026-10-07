import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from environment import load_environment


class EnvironmentTests(unittest.TestCase):
    def test_local_settings_preserve_secrets_and_deployment_overrides(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'EXISTING': 'deployment'}, clear=True):
            path = Path(folder) / '.env'
            path.write_text('\ufeff# Settings\nEXISTING=local\nexport TOKEN="secret # value=with equals" # comment\nEMPTY=\nORIGIN=http://localhost:3000 # local\n', encoding='utf-8')
            load_environment(path)
            self.assertEqual(os.environ['EXISTING'], 'deployment')
            self.assertEqual(os.environ['TOKEN'], 'secret # value=with equals')
            self.assertEqual(os.environ['EMPTY'], '')
            self.assertEqual(os.environ['ORIGIN'], 'http://localhost:3000')

    def test_missing_file_is_allowed(self):
        with tempfile.TemporaryDirectory() as folder:
            load_environment(Path(folder) / 'missing.env')

    def test_invalid_settings_do_not_expose_values(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / '.env'
            path.write_text('TOKEN="private-value', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, '^Invalid quoted environment setting on line 1.$'):
                load_environment(path)
