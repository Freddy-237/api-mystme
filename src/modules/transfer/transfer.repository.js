/**
 * Data access for PWA → app identity transfer. Every function takes the
 * transaction client: a transfer is all-or-nothing.
 */

const invalidateActiveTokens = (client, userId) =>
  client.query(
    `UPDATE identity_transfer_tokens
        SET consumed_at = NOW()
      WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId],
  );

const createToken = (client, { id, userId, codeHash, expiresAt }) =>
  client.query(
    `INSERT INTO identity_transfer_tokens (id, user_id, code_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [id, userId, codeHash, expiresAt],
  );

const findTokenByHashForUpdate = async (client, codeHash) => {
  const result = await client.query(
    `SELECT id, user_id, expires_at, consumed_at
       FROM identity_transfer_tokens
      WHERE code_hash = $1
      FOR UPDATE`,
    [codeHash],
  );
  return result.rows[0];
};

const consumeToken = (client, tokenId, consumerId) =>
  client.query(
    `UPDATE identity_transfer_tokens
        SET consumed_at = NOW(), consumed_by = $2
      WHERE id = $1`,
    [tokenId, consumerId],
  );

/** Lock both users in a stable order (avoids deadlocks between two claims). */
const lockUsers = async (client, userIds) => {
  const result = await client.query(
    `SELECT id, origin, is_banned, merged_into_user_id, pseudo, avatar_url
       FROM users
      WHERE id = ANY($1::uuid[])
      ORDER BY id
      FOR UPDATE`,
    [userIds],
  );
  return new Map(result.rows.map((row) => [row.id, row]));
};

/**
 * Move everything the web identity did as an anonymous participant onto the
 * app identity.
 *  - conversation not yet known by the app user → re-assigned (alias kept);
 *  - app user already talks on the same link → messages merged into it;
 *  - conversation on the app user's OWN link → left untouched (would become
 *    a conversation with oneself).
 */
const mergeIdentities = async (client, webId, appId) => {
  const { rows: conversations } = await client.query(
    `SELECT id, link_id, owner_id, started_at
       FROM conversations
      WHERE anonymous_id = $1
      FOR UPDATE`,
    [webId],
  );

  const moved = [];
  const mergedInto = [];
  const skipped = [];

  for (const conv of conversations) {
    if (conv.owner_id === appId) {
      skipped.push(conv.id);
      continue;
    }

    const { rows: [existing] } = await client.query(
      `SELECT id FROM conversations
        WHERE link_id = $1 AND anonymous_id = $2
        FOR UPDATE`,
      [conv.link_id, appId],
    );

    if (!existing) {
      await client.query(
        `UPDATE conversations c
            SET anonymous_id = $1,
                anonymous_alias = COALESCE(c.anonymous_alias, w.pseudo),
                anonymous_avatar_url = COALESCE(c.anonymous_avatar_url, w.avatar_url)
           FROM users w
          WHERE c.id = $3 AND w.id = $2`,
        [appId, webId, conv.id],
      );
      moved.push(conv.id);
      continue;
    }

    // Same link on both sides: fold the web conversation into the app one.
    await client.query(
      'UPDATE messages SET conversation_id = $1 WHERE conversation_id = $2',
      [existing.id, conv.id],
    );
    await client.query(
      `DELETE FROM reports r
        WHERE r.conversation_id = $2
          AND r.message_id IS NULL
          AND EXISTS (
            SELECT 1 FROM reports x
             WHERE x.conversation_id = $1
               AND x.message_id IS NULL
               AND x.reported_by = r.reported_by
          )`,
      [existing.id, conv.id],
    );
    await client.query(
      'UPDATE reports SET conversation_id = $1 WHERE conversation_id = $2',
      [existing.id, conv.id],
    );
    await client.query(
      `UPDATE conversations
          SET started_at = CASE
            WHEN started_at IS NULL THEN $2::timestamp
            WHEN $2::timestamp IS NULL THEN started_at
            ELSE LEAST(started_at, $2::timestamp)
          END
        WHERE id = $1`,
      [existing.id, conv.started_at],
    );
    await client.query('DELETE FROM conversations WHERE id = $1', [conv.id]);
    mergedInto.push(existing.id);
  }

  const touched = [...moved, ...mergedInto];
  if (touched.length > 0) {
    await client.query(
      `UPDATE messages SET sender_id = $1
        WHERE sender_id = $2 AND conversation_id = ANY($3::uuid[])`,
      [appId, webId, touched],
    );
    await client.query(
      `INSERT INTO conversation_user_status (conversation_id, user_id, status, updated_at)
       SELECT conversation_id, $1, status, NOW()
         FROM conversation_user_status
        WHERE user_id = $2 AND conversation_id = ANY($3::uuid[])
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      [appId, webId, touched],
    );
    await client.query(
      `DELETE FROM conversation_user_status
        WHERE user_id = $1 AND conversation_id = ANY($2::uuid[])`,
      [webId, touched],
    );
  }

  // Per-user data that is not tied to a single conversation.
  await client.query(
    `INSERT INTO hidden_messages (user_id, message_id, hidden_at)
     SELECT $1, message_id, hidden_at FROM hidden_messages WHERE user_id = $2
     ON CONFLICT (user_id, message_id) DO NOTHING`,
    [appId, webId],
  );
  await client.query('DELETE FROM hidden_messages WHERE user_id = $1', [webId]);

  await client.query(
    `DELETE FROM reports r
      WHERE r.reported_by = $2
        AND EXISTS (
          SELECT 1 FROM reports x
           WHERE x.reported_by = $1
             AND ((r.message_id IS NULL AND x.message_id IS NULL AND x.conversation_id = r.conversation_id)
               OR (r.message_id IS NOT NULL AND x.message_id = r.message_id))
        )`,
    [appId, webId],
  );
  await client.query('UPDATE reports SET reported_by = $1 WHERE reported_by = $2', [appId, webId]);

  await client.query(
    `UPDATE users SET merged_into_user_id = $1, merged_at = NOW() WHERE id = $2`,
    [appId, webId],
  );

  return { moved, mergedInto, skipped };
};

module.exports = {
  invalidateActiveTokens,
  createToken,
  findTokenByHashForUpdate,
  consumeToken,
  lockUsers,
  mergeIdentities,
};
