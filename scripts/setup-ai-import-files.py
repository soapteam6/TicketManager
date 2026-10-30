"""Enable standard Dataverse Notes on AI Import jobs; read-only unless --apply.

No new table, connection, credential change, or ticket-data mutation.
"""
import argparse
from dataverse_api import Dataverse, ORG
from schedule_search_flow import TABLE


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    d = Dataverse()
    path = f"EntityDefinitions(LogicalName='{TABLE}')"
    metadata = d.call('GET', path, params={'$select': 'LogicalName,HasNotes'})
    print(f"Verified emikes@ais-now.com; {ORG}; enable Notes only on {TABLE}.")
    if metadata.get('HasNotes'):
        print('AI Import jobs already support file attachments.')
    elif args.apply:
        d.call('PUT', path, {'@odata.type': 'Microsoft.Dynamics.CRM.EntityMetadata', 'HasNotes': True}, headers={'MSCRM.MergeLabels': 'true'})
        d.call('POST', 'PublishXml', {'ParameterXml': f'<importexportxml><entities><entity>{TABLE}</entity></entities></importexportxml>'})
        assert d.call('GET', path, params={'$select': 'HasNotes'})['HasNotes'] is True
        print('Enabled standard Notes/file attachments on AI Import jobs; ticket records unchanged.')
    else:
        print('Read-only plan. Use --apply after announcing this metadata change.')


if __name__ == '__main__':
    main()
