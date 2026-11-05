-- The app only uses the normal REST API. The GraphQL feature let any signed-in
-- account list the names of every table, so it is switched off.
drop extension if exists pg_graphql;
