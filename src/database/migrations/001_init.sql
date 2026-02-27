-- ============================================
-- MystMe — Initial schema
-- ============================================

-- Drop old tables (from previous Prisma setup) if they exist
DROP TABLE IF EXISTS "Message" CASCADE;
DROP TABLE IF EXISTS "Participant" CASCADE;
DROP TABLE IF EXISTS "Conversation" CASCADE;
DROP TABLE IF EXISTS "User" CASCADE;
DROP TABLE IF EXISTS "_prisma_migrations" CASCADE;

-- Drop new tables if re-running
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS trust_status CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS links CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================
-- 1. users (identités anonymes)
-- ============================================
CREATE TABLE users (
  id            UUID PRIMARY KEY,
  anonymous_uid UUID UNIQUE NOT NULL,
  pseudo        VARCHAR(100) NOT NULL,
  avatar_url    TEXT,
  last_seen_at  TIMESTAMP DEFAULT NOW(),
  created_at    TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- 2. links (liens de partage)
-- ============================================
CREATE TABLE links (
  id            UUID PRIMARY KEY,
  code          VARCHAR(20) UNIQUE NOT NULL,
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_links_code ON links(code);
CREATE INDEX idx_links_owner ON links(owner_id);

-- Conversations entre le propriétaire du lien et un anonyme
CREATE TABLE conversations (
  id            UUID PRIMARY KEY,
  link_id       UUID NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anonymous_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  status        VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'archived')),
  started_at    TIMESTAMP DEFAULT NOW(),
  blocked_at    TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_conversations_link ON conversations(link_id);
CREATE INDEX idx_conversations_owner ON conversations(owner_id);
CREATE INDEX idx_conversations_anonymous ON conversations(anonymous_id);

-- ============================================
-- 4. messages
-- ============================================
CREATE TABLE messages (
  id                UUID PRIMARY KEY,
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content           TEXT NOT NULL,
  is_deleted        BOOLEAN DEFAULT false,
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_sender ON messages(sender_id);

-- ============================================
-- 5. trust_status
-- ============================================
CREATE TABLE trust_status (
  id                UUID PRIMARY KEY,
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  status            VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'known', 'trusted', 'revealed')),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_trust_conversation ON trust_status(conversation_id);

-- ============================================
-- 6. reports (modération)
-- ============================================
CREATE TABLE reports (
  id                UUID PRIMARY KEY,
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id        UUID REFERENCES messages(id) ON DELETE SET NULL,
  reported_by       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason            TEXT DEFAULT 'Contenu inapproprié',
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_reports_conversation ON reports(conversation_id);
