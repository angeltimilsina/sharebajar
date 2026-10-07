"""Compatibility view: all runtime catalog reads come from the central registry."""
from collections.abc import Sequence
from asset_seed import REGIONS
from asset_store import list_assets
class AssetView(Sequence):
    def __iter__(self):return iter(list_assets(limit=100000))
    def __len__(self):return len(list_assets(limit=100000))
    def __getitem__(self,index):return list_assets(limit=100000)[index]
ASSETS=AssetView()
