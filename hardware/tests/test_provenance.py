import json
from pathlib import Path
from cad.config import load


def test_parameter_records_match_current_revision():
    parameters = load()
    records = json.loads(Path("cad/parameter_sources.json").read_text())
    for path, record in records.items():
        group, key = path.split(".")
        assert parameters[group][key] == record["value"], path
    for group, values in parameters.items():
        if isinstance(values, dict):
            assert all(f"{group}.{key}" in records for key in values), group
