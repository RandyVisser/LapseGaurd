"""
Guard: every alert processor that scripts/run_alerts.py main() runs must ALSO be
called by the /alerts/run endpoint in routes/alerts.py.

Why this exists: the GitHub Actions cron curls POST /alerts/run. It does NOT
execute run_alerts.py. So a processor added only to the script never runs in
production — it just silently doesn't happen, with no error and no symptom.
Per CLAUDE.md this has already shipped silently-dead features twice.

Static (AST) comparison rather than importing, so the test needs no DB, no env
vars and no network. It reads the two files as source.
"""
import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
SCRIPT = BACKEND / "scripts" / "run_alerts.py"
ROUTE = BACKEND / "routes" / "alerts.py"


def _fn(tree: ast.Module, name: str) -> ast.AsyncFunctionDef | ast.FunctionDef:
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)) and node.name == name:
            return node
    raise AssertionError(f"{name}() not found — did it get renamed?")


def _called_names(node: ast.AST) -> set[str]:
    """Every plain function name called anywhere inside node."""
    out = set()
    for sub in ast.walk(node):
        if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name):
            out.add(sub.func.id)
    return out


def _processors(names: set[str]) -> set[str]:
    return {n for n in names if n.startswith("process_")}


class TestAlertProcessorParity:
    def test_every_script_processor_runs_in_the_endpoint(self):
        script = _processors(_called_names(_fn(ast.parse(SCRIPT.read_text()), "main")))
        route = _processors(_called_names(_fn(ast.parse(ROUTE.read_text()), "run_alerts")))

        assert script, "no process_* calls found in run_alerts.main() — parser broken?"

        missing = script - route
        assert not missing, (
            "These alert processors run in scripts/run_alerts.py main() but NOT in "
            f"/alerts/run: {sorted(missing)}.\n"
            "The cron only calls the endpoint, so they would never run in production. "
            "Add them to run_alerts() in routes/alerts.py."
        )

    def test_endpoint_has_no_orphan_processors(self):
        """The reverse is not a production bug, but a processor in the endpoint and
        not the script means the script is no longer a faithful local mirror —
        worth knowing when someone debugs alerts by running it by hand."""
        script = _processors(_called_names(_fn(ast.parse(SCRIPT.read_text()), "main")))
        route = _processors(_called_names(_fn(ast.parse(ROUTE.read_text()), "run_alerts")))

        orphans = route - script
        assert not orphans, (
            f"In /alerts/run but not run_alerts.py main(): {sorted(orphans)}. "
            "Running the script locally will not reproduce production."
        )
