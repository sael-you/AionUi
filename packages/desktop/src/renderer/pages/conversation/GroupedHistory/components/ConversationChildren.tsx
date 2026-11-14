/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

import type { ConversationTreeNode } from '../utils/conversationTree';

type ConversationChildrenProps = {
  nodes: readonly ConversationTreeNode[];
  isExpanded: (conversationId: string) => boolean;
  renderRow: (node: ConversationTreeNode) => React.ReactNode;
};

/** Recursively render the (already expanded) children of a conversation row. */
const ConversationChildren: React.FC<ConversationChildrenProps> = ({ nodes, isExpanded, renderRow }) => (
  <div role='group' className='min-w-0'>
    {nodes.map((node) => (
      <React.Fragment key={node.conversation.id}>
        {renderRow(node)}
        {node.children.length > 0 && isExpanded(node.conversation.id) && (
          <ConversationChildren nodes={node.children} isExpanded={isExpanded} renderRow={renderRow} />
        )}
      </React.Fragment>
    ))}
  </div>
);

export default ConversationChildren;
