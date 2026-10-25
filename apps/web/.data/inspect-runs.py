import sqlite3

conn = sqlite3.connect("apps/web/.data/agent-os.db")
cols = conn.execute("pragma table_info(workspaces)").fetchall()
print("workspace cols", [c[1] for c in cols])
print("migrations", conn.execute("select * from __drizzle_migrations").fetchall() if True else None)
try:
    conn.execute("select action_effects from workspaces limit 1")
    print("action_effects present")
except Exception as e:
    print("missing", e)
    conn.execute("ALTER TABLE workspaces ADD action_effects text DEFAULT '{}' NOT NULL")
    conn.commit()
    print("added action_effects")
