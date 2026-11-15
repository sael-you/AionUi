/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import classNames from 'classnames';
import React from 'react';

import styles from '../ConversationRow.module.css';

import type { ConversationTreeNode } from '../utils/conversationTree';

/** Where a row sits among its siblings (aria-posinset / aria-setsize). */
export type ConversationChildPosition = {
  /** 1-based position among the siblings. */
  posinset: number;
  setsize: number;
};

type ConversationChildrenProps = {
  nodes: readonly ConversationTreeNode[];
  isExpanded: (conversationId: string) => boolean;
  renderRow: (node: ConversationTreeNode, position: ConversationChildPosition) => React.ReactNode;
};

/** Recursively render the (already expanded) children of a conversation row, hanging off one guide line (C24). */
const ConversationChildren: React.FC<ConversationChildrenProps> = ({ nodes, isExpanded, renderRow }) => (
  <div
    role='group'
    className={classNames('min-w-0', styles.childGroup)}
    style={{ '--group-depth': nodes[0]?.depth ?? 1 } as React.CSSProperties}
  >
    {nodes.map((node, index) => (
      <React.Fragment key={node.conversation.id}>
        {renderRow(node, { posinset: index + 1, setsize: nodes.length })}
        {node.children.length > 0 && isExpanded(node.conversation.id) && (
          <ConversationChildren nodes={node.children} isExpanded={isExpanded} renderRow={renderRow} />
        )}
      </React.Fragment>
    ))}
  </div>
);

export default ConversationChildren;
