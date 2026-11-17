/**
 * Dashboard figures. Aggregates only: no row ever leaves this module with a
 * user id, a pseudo or message content.
 */
const pool = require('../../config/database');

const clampDays = (days) => Math.max(7, Math.min(Number(days) || 30, 90));

const getDashboard = async ({ days = 30 } = {}) => {
  const span = clampDays(days);

  const [totals, daily, funnel, activity] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE origin = 'app' AND merged_into_user_id IS NULL)::int AS app_users,
        (SELECT COUNT(*) FROM users WHERE origin = 'web' AND merged_into_user_id IS NULL)::int AS web_users,
        -- "Engaged": the account sent at least one message. An identity is
        -- created on every first open of the app or the PWA, so the raw
        -- account count is inflated by people who never did anything.
        (SELECT COUNT(*) FROM users u WHERE u.origin = 'app' AND u.merged_into_user_id IS NULL
            AND EXISTS (SELECT 1 FROM messages m WHERE m.sender_id = u.id))::int AS engaged_app_users,
        (SELECT COUNT(*) FROM users u WHERE u.origin = 'web' AND u.merged_into_user_id IS NULL
            AND EXISTS (SELECT 1 FROM messages m WHERE m.sender_id = u.id))::int AS engaged_web_users,
        (SELECT COUNT(DISTINCT owner_id) FROM links)::int AS users_with_link,
        (SELECT COUNT(*) FROM links WHERE is_active)::int AS active_links,
        (SELECT COUNT(*) FROM conversations WHERE started_at IS NOT NULL)::int AS conversations,
        (SELECT COUNT(*) FROM messages)::int AS messages,
        (SELECT COUNT(*) FROM users WHERE is_banned)::int AS banned_users,
        (SELECT COUNT(*) FROM reports WHERE status = 'pending')::int AS pending_reports,
        (SELECT COUNT(DISTINCT user_id) FROM subscriptions
          WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW()))::int AS premium_users
    `),
    pool.query(
      `WITH days AS (
         SELECT generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, INTERVAL '1 day')::date AS day
       )
       SELECT d.day,
              (SELECT COUNT(*) FROM users u WHERE u.origin = 'app' AND u.created_at::date = d.day)::int AS new_app_users,
              (SELECT COUNT(*) FROM users u WHERE u.origin = 'web' AND u.created_at::date = d.day)::int AS new_web_users,
              (SELECT COUNT(*) FROM conversations c WHERE c.started_at::date = d.day)::int AS conversations,
              (SELECT COUNT(*) FROM messages m WHERE m.created_at::date = d.day)::int AS messages,
              (SELECT COUNT(*) FROM reports r WHERE r.created_at::date = d.day)::int AS reports
         FROM days d
        ORDER BY d.day`,
      [span],
    ),
    pool.query(
      `SELECT
         (SELECT COUNT(*) FROM users
           WHERE origin = 'web' AND created_at >= NOW() - ($1::int * INTERVAL '1 day'))::int AS web_identities,
         (SELECT COUNT(*) FROM identity_transfer_tokens
           WHERE consumed_at IS NOT NULL AND consumed_at >= NOW() - ($1::int * INTERVAL '1 day'))::int AS transfers`,
      [span],
    ),
    pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE last_seen_at >= NOW() - INTERVAL '1 day' AND merged_into_user_id IS NULL)::int AS active_1d,
        (SELECT COUNT(*) FROM users WHERE last_seen_at >= NOW() - INTERVAL '7 days' AND merged_into_user_id IS NULL)::int AS active_7d,
        (SELECT COUNT(*) FROM users WHERE last_seen_at >= NOW() - INTERVAL '30 days' AND merged_into_user_id IS NULL)::int AS active_30d
    `),
  ]);

  const t = totals.rows[0];
  const f = funnel.rows[0];
  const a = activity.rows[0];

  return {
    days: span,
    generatedAt: new Date().toISOString(),
    totals: {
      appUsers: t.app_users,
      webUsers: t.web_users,
      engagedAppUsers: t.engaged_app_users,
      engagedWebUsers: t.engaged_web_users,
      usersWithLink: t.users_with_link,
      activeLinks: t.active_links,
      conversations: t.conversations,
      messages: t.messages,
      bannedUsers: t.banned_users,
      pendingReports: t.pending_reports,
      premiumUsers: t.premium_users,
    },
    activity: { active1d: a.active_1d, active7d: a.active_7d, active30d: a.active_30d },
    webToApp: {
      webIdentities: f.web_identities,
      transfers: f.transfers,
      rate: f.web_identities > 0 ? Math.round((f.transfers / f.web_identities) * 1000) / 10 : null,
    },
    daily: daily.rows.map((r) => ({
      day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
      newAppUsers: r.new_app_users,
      newWebUsers: r.new_web_users,
      conversations: r.conversations,
      messages: r.messages,
      reports: r.reports,
    })),
  };
};

module.exports = { getDashboard, clampDays };
