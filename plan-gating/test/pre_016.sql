-- state of a live 013 deployment: some plans, some MCP usage this month
insert into auth.users values ('00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-0000000000d2');
insert into user_plans(user_id, plan, current_period_end) values ('00000000-0000-0000-0000-0000000000d1', 'pro', now() + interval '10 days'), ('00000000-0000-0000-0000-0000000000d2', 'team', null);
insert into mcp_usage(user_id, period, requests) values ('00000000-0000-0000-0000-0000000000d1', date_trunc('month', now() at time zone 'utc')::date, 37);
