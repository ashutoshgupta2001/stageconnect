# Your booking API was working fine at 1,000 users. After a marketing campaign the platform reached
50,000 users. The GET /artists/search endpoint is now timing out. MySQL CPU is at 90% during peak
hours. You have 48 hours and cannot take the platform offline.

1. The two most likely causes are inefficient search queries, caused by missing or unsuitable indexes and expensive joins or sorting; and repeated, uncached searches overwhelming MySQL as request volume increases. These are hypotheses: 50,000 registered users does not establish concurrent demand.

   First, correlate endpoint traffic and latency with MySQL query digests ranked by total execution time. Check rows examined versus returned, query frequency, and application traces for repeated queries. Inspect representative slow queries with EXPLAIN to identify scans and index usage. [MySQL documentation](https://dev.mysql.com/doc/refman/8.4/en/using-explain.html)

2. Spend hours 0–6 confirming the bottleneck and recording baseline CPU, throughput, and p95 latency. During hours 6–36, make two changes:

   Cache popular search responses in Redis for 30–60 seconds, using normalized filters, sorting, pagination, and permission scope as keys. Invalidate affected entries after updates and coalesce simultaneous cache misses to prevent stampedes. [Caching guidance](https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside)

   Add a composite index matched to the confirmed query’s filters and ordering. Validate it against representative data first. Build it during lower traffic using an online operation supported by the deployed MySQL version, with bounded metadata-lock waits and resource monitoring. [Online DDL limitations](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-limitations.html)

   Use hours 36–48 for gradual rollout and peak-like load testing. Keep rollback available; verify fewer database queries, lower CPU, and reduced p95 latency without interrupting service.

3. Move artist discovery to a dedicated Elasticsearch search index, synchronized through change-data capture, while MySQL remains authoritative for bookings. Search then scales independently. Accept additional infrastructure cost, synchronization complexity, and eventual consistency: search results can briefly lag updates. [Elastic documentation](https://www.elastic.co/docs/manage-data/data-store/near-real-time-search) Revalidate availability and reserve atomically in MySQL when booking, so stale search results cannot cause double bookings.
