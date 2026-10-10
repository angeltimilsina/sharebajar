#!/usr/bin/env python3
"""Read-only milestone verification and bounded build-prompt generator."""
import json, pathlib, subprocess, sys, datetime
ROOT=pathlib.Path(__file__).resolve().parents[1]
doc=json.loads((ROOT/"sharebajar-milestones.json").read_text())
report={"checked_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"goal":doc["goal"],"milestones":[]}
for m in doc["milestones"]:
    missing=[p for p in m.get("evidence",[]) if not (ROOT/p).is_file()]
    report["milestones"].append({"id":m["id"],"declared_status":m["status"],"evidence_files_present":not missing,"missing_files":missing,"verified":False,"reason":"Existence of source files is not proof of functionality; follow tests and external verification."})
not_done=[m for m in doc["milestones"] if m["status"]!="verified"]
next_item=not_done[0] if not_done else None
prompt={"goal":doc["goal"],"instruction":"Choose one incomplete milestone, implement a minimal testable increment, run tests, update status with evidence. Do not touch secrets, publish real-money contracts, or claim completion without proof.","target":next_item,"acceptance_criteria":next_item.get("tests",[]) if next_item else []}
(ROOT/"build-report.json").write_text(json.dumps(report,indent=2)+"\n")
(ROOT/"next-build-prompt.json").write_text(json.dumps(prompt,indent=2)+"\n")
print(json.dumps({"incomplete":len(not_done),"next":next_item["id"] if next_item else None,"report":"build-report.json","prompt":"next-build-prompt.json"}))
if any(not m["evidence_files_present"] for m in report["milestones"]):sys.exit(1)
