"""Offline checks for the component-coverage guard before retiring the QA container."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("consolidation", Path(__file__).with_name("consolidate-ticket-solutions.py"))
consolidation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(consolidation)


def component(kind, object_id, row_id, behavior=0, parent=None):
    return {"componenttype": kind, "objectid": object_id, "solutioncomponentid": row_id,
            "rootcomponentbehavior": behavior, "rootsolutioncomponentid": parent}


class CoverageTests(unittest.TestCase):
    def test_full_table_covers_explicit_columns_from_a_partial_table(self):
        source = [component(1, "table", "source-table", 1), component(2, "column", "source-column", parent="source-table")]
        self.assertEqual(consolidation.coverage(source, [component(1, "table", "target-table")]), [])

    def test_partial_table_does_not_implicitly_cover_a_missing_column(self):
        source = [component(1, "table", "source-table", 1), component(2, "column", "source-column", parent="source-table")]
        self.assertEqual(consolidation.coverage(source, [component(1, "table", "target-table", 1)]), [source[1]])

    def test_shell_does_not_cover_a_full_source_table(self):
        source = [component(1, "table", "source-table")]
        self.assertEqual(consolidation.coverage(source, [component(1, "table", "target-table", 2)]), source)

    def test_missing_standalone_api_parameter_is_not_ignored(self):
        source = [component(10026, "api", "api-row"), component(10027, "parameter", "parameter-row")]
        self.assertEqual(consolidation.coverage(source, [component(10026, "api", "other-api-row")]), [source[1]])

    def test_object_ids_must_match_as_well_as_component_types(self):
        source = [component(20, "first-role", "first-row")]
        self.assertEqual(consolidation.coverage(source, [component(20, "other-role", "other-row")]), source)

    def test_unrelated_full_table_cannot_cover_the_source_column(self):
        source = [component(1, "first-table", "first-row", 1), component(2, "column", "column-row", parent="first-row")]
        self.assertEqual(consolidation.coverage(source, [component(1, "other-table", "other-row")]), source)

    def test_explicit_columns_are_covered_without_requiring_full_table_export(self):
        source = [component(1, "table", "source-table", 1), component(2, "column", "source-column", parent="source-table")]
        target = [component(1, "table", "target-table", 1), component(2, "column", "target-column", parent="target-table")]
        self.assertEqual(consolidation.coverage(source, target), [])


if __name__ == "__main__":
    unittest.main()
