# Hierarchical Conversations

Parent conversations can spawn nested **sub-conversations** so an agent (or the user) can fan work out in parallel and collect the results back in the parent.

## Model

- Every conversation has an optional `parent_conversation_id` and a `depth` (`0` = root).
- Limits (enforced by the backend): **depth ≤ 3** and **≤ 12 direct children per parent**.
- Pin, drag-sort and the Projects/Chats grouping apply to **roots only**. A child never appears as a top-level sidebar item; it only appears under its root.
- Team-owned conversations stay hidden from the sidebar exactly as before.

## Wire contract (v1)

| Surface                               | Fields                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ConversationResponse`                | `parent_conversation_id?`, `depth`                                                                               |
| `GET /api/sidebar` conversation items | `descendants?` (flat, all levels, `created_at` ASC), `descendant_count?`, `running_descendant_count?`            |
| `POST /api/conversations`             | optional `parent_conversation_id`                                                                                |
| `PUT /api/conversations/{id}/parent`  | body `{ parent_conversation_id: string \| null }` (`null` detaches to root)                                      |
| Error codes                           | `parent_not_found`, `parent_depth_exceeded`, `parent_fanout_exceeded`, `parent_cycle` (shown as friendly toasts) |

The main sidebar currently reads the flat conversation list; it derives the tree client-side from `parent_conversation_id`. Orphans (parent not loaded) and cycle members are never hidden: they render as top-level rows.

## Spawn flows

1. **Agent-initiated**: the agent creates a child through the CLI (`conversation create --parent <id>`). The existing list-changed / history-refresh path makes the child appear live under its parent.
2. **User-initiated**: row menu > **New sub-conversation** creates a child that inherits the parent's workspace and assistant, navigates to it and expands the parent. Hidden at depth 3.
3. **Reparent**: row menu > **Move under…** (Select of eligible parents; excludes self, own descendants, and targets that would break the depth or fan-out limits) and **Detach from parent** (children only).

## Result return

When a child finishes, its result is delivered into the parent as a block:

```
[[AION_CHILD_RESULT child_id=<id> name=<name> status=<status>]]
...result text...
[[/AION_CHILD_RESULT]]
```

The parent's message list renders it as a compact, collapsible **Sub-agent result: <name>** card with an **Open** link to the child. A malformed block (no closing marker or no `child_id`) is shown as plain text.

## Sidebar behaviour

- A root with sub-conversations shows a chevron (expand/collapse, persisted in `localStorage` under `aionui_conversation_tree_expansion`).
- Collapsed parents show a rollup badge: direct-child count, a spinner while any descendant runs, and an attention icon when any descendant awaits confirmation.
- Children are indented per depth with a connector line and thinner secondary styling. The branch containing the active conversation auto-expands.
- A child conversation's header shows a breadcrumb linking to its parent.
- Archive confirmations mention sub-conversations when the row has descendants. Batch mode: selecting a parent implies its subtree and the counts reflect it.
- Semantics: rows use `role="treeitem"` with `aria-level` / `aria-expanded`; Left/Right arrows collapse/expand a focused parent.

## Not included (v1)

- Drag-to-reparent (use **Move under…**).
- An error rollup: conversations expose no error status yet, so the helper supports it but the sidebar does not surface it.
