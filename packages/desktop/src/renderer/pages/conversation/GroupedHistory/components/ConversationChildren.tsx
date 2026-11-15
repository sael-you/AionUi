/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

import type { ConversationTreeNode } from '../utils/conversationTree';

/** Where a row sits among its siblings, for the tree connectors (C21). */
export type ConversationChildPosition = {
  /** Per ancestor level 1..depth-1: that ancestor has a later sibling. */
  continues: boolean[];
  /** A later sibling follows at the same depth. */
  hasNextSibling: boolean;
  /** 1-based position among the siblings. */
  posinset: number;
  setsize: number;
};

type ConversationChildrenProps = {
  nodes: readonly ConversationTreeNode[];
  isExpanded: (conversationId: string) => boolean;
  renderRow: (node: ConversationTreeNode, position: ConversationChildPosition) => React.ReactNode;
  /** Ancestor continuation flags of `nodes` (empty for a root's children). */
  continues?: boolean[];
};

/** Recursively render the (already expanded) children of a conversation row. */
const ConversationChildren: React.FC<ConversationChildrenProps> = ({
  nodes,
  isExpanded,
  renderRow,
  continues = [],
}) => (
  <div role='group' className='min-w-0'>
    {nodes.map((node, index) => {
      const hasNextSibling = index < nodes.length - 1;
      return (
        <React.Fragment key={node.conversation.id}>
          {renderRow(node, { continues, hasNextSibling, posinset: index + 1, setsize: nodes.length })}
          {node.children.length > 0 && isExpanded(node.conversation.id) && (
            <ConversationChildren
              nodes={node.children}
              isExpanded={isExpanded}
              renderRow={renderRow}
              continues={[...continues, hasNextSibling]}
            />
          )}
        </React.Fragment>
      );
    })}
  </div>
);

export default ConversationChildren;
