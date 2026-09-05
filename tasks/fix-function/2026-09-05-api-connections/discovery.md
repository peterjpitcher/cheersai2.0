# API connections discovery

Scope: CheersAI management connection diagnostics and booking evidence used by campaign optimisation. Read current settings action, management client, conversion loaders, cron run status path and regression harnesses. Source checkout stays untouched. No schema or external write changes.

Evidence: the live management conversion GET returned 500. Its table status filter includes an invalid seated enum value (management owner fixes this). CheersAI previously replaced this failure with an empty list, and Settings checked only one event. Booking ingestion itself is active and is unchanged.

Critical paths: settings test action, management client, optimisation conversion loaders and existing failed-run handling. Supporting: settings form summary and cron failure result. Peripheral: tests and task documentation. Sibling check found local booking conversion query errors also becoming empty lists; these must stop recommendations too.

Complexity: 3, moderate logic, no schema changes. Independently deployable after management endpoint repair; prior deployment safely reports failed runs until management is repaired.
