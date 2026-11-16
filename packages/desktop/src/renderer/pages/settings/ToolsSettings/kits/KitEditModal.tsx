/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Create or edit a kit: name, description, library skills, MCP market
 * instances, and wanted catalogue templates that have no instance yet ("needs
 * an instance", never delivered). Editing replaces every member set and is
 * guarded by the kit's `updated_at` (409 when it changed elsewhere).
 */

import { Alert, Input, Message, Modal, Select } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { KitResponse } from '@/common/config/storage';
import {
  KIT_NAME_MAX,
  describeKitError,
  kitFormFromKit,
  validateKitForm,
  type KitFormError,
  type KitFormValues,
} from '@/renderer/hooks/mcp/market/kitModel';
import { describeMarketError } from '@/renderer/hooks/mcp/market/marketModel';
import { useKitActions, useKitLibrary } from '@/renderer/hooks/mcp/market/useKits';

type KitEditModalProps = {
  visible: boolean;
  /** `null` = create. */
  kit: KitResponse | null;
  onClose: () => void;
};

/** Options for a multi-select: the library entries plus any current value the library no longer lists. */
const withCurrent = (names: readonly string[], current: readonly string[]): string[] =>
  [...new Set([...names, ...current])].toSorted();

const KitEditModal: React.FC<KitEditModalProps> = ({ visible, kit, onClose }) => {
  const { t } = useTranslation();
  const library = useKitLibrary();
  const { createKit, updateKit } = useKitActions();
  const [values, setValues] = useState<KitFormValues>(() => kitFormFromKit(kit));
  const [formError, setFormError] = useState<KitFormError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setValues(kitFormFromKit(kit));
    setFormError(null);
  }, [visible, kit]);

  const update = (patch: Partial<KitFormValues>) => setValues((previous) => ({ ...previous, ...patch }));

  const instanceNameOf = (id: string): string =>
    library.instances.find((instance) => instance.id === id)?.name ??
    kit?.mcps.find((member) => member.instance_id === id)?.instance_name ??
    id;

  const handleSave = async () => {
    const problem = validateKitForm(values);
    setFormError(problem);
    if (problem) return;
    setSaving(true);
    try {
      if (kit) {
        await updateKit(kit, values);
      } else {
        await createKit(values);
      }
      Message.success(t('mcp.kits.saved'));
      onClose();
    } catch (saveError) {
      Message.error(describeKitError(t, saveError));
    } finally {
      setSaving(false);
    }
  };

  const skillOptions = withCurrent(library.skillNames, values.skills);
  const instanceOptions = withCurrent(
    library.instances.map((instance) => instance.id),
    values.mcpInstanceIds
  );
  const templateOptions = withCurrent(
    library.templates.map((template) => template.id),
    values.mcpTemplates
  );

  return (
    <Modal
      visible={visible}
      title={kit ? t('mcp.kits.edit') : t('mcp.kits.create')}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      confirmLoading={saving}
      onOk={() => void handleSave()}
      onCancel={onClose}
      unmountOnExit
      autoFocus={false}
      style={{ maxWidth: 'calc(100vw - 32px)', width: 560 }}
    >
      <div className='flex flex-col gap-14px' data-testid='kit-edit-modal'>
        {library.error ? <Alert type='warning' content={describeMarketError(t, library.error)} /> : null}
        <label className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>{t('mcp.kits.form.name')}</span>
          <Input
            value={values.name}
            maxLength={KIT_NAME_MAX}
            placeholder={t('mcp.kits.form.namePlaceholder')}
            status={formError === 'nameRequired' || formError === 'nameTooLong' ? 'error' : undefined}
            onChange={(value) => update({ name: value })}
          />
        </label>
        <label className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>{t('mcp.kits.form.description')}</span>
          <Input.TextArea
            value={values.description}
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder={t('mcp.kits.form.descriptionPlaceholder')}
            onChange={(value) => update({ description: value })}
          />
        </label>
        <div className='flex flex-col gap-6px'>
          <span id='kit-form-skills' className='text-13px text-t-secondary'>
            {t('mcp.kits.skills')}
          </span>
          <Select
            mode='multiple'
            allowClear
            showSearch
            aria-labelledby='kit-form-skills'
            value={values.skills}
            placeholder={t('mcp.kits.form.skillsPlaceholder')}
            onChange={(value: string[]) => update({ skills: value })}
          >
            {skillOptions.map((name) => (
              <Select.Option key={name} value={name}>
                {name}
              </Select.Option>
            ))}
          </Select>
        </div>
        <div className='flex flex-col gap-6px'>
          <span id='kit-form-mcps' className='text-13px text-t-secondary'>
            {t('mcp.kits.mcps')}
          </span>
          <Select
            mode='multiple'
            allowClear
            showSearch
            aria-labelledby='kit-form-mcps'
            value={values.mcpInstanceIds}
            placeholder={t('mcp.kits.form.mcpsPlaceholder')}
            filterOption={(input, option) =>
              instanceNameOf(String((option as { props?: { value?: unknown } }).props?.value ?? ''))
                .toLowerCase()
                .includes(input.toLowerCase())
            }
            onChange={(value: string[]) => update({ mcpInstanceIds: value })}
          >
            {instanceOptions.map((id) => (
              <Select.Option key={id} value={id}>
                {instanceNameOf(id)}
              </Select.Option>
            ))}
          </Select>
        </div>
        <div className='flex flex-col gap-6px'>
          <span id='kit-form-templates' className='text-13px text-t-secondary'>
            {t('mcp.kits.form.templates')}
          </span>
          <Select
            mode='multiple'
            allowClear
            showSearch
            aria-labelledby='kit-form-templates'
            value={values.mcpTemplates}
            placeholder={t('mcp.kits.form.templatesPlaceholder')}
            onChange={(value: string[]) => update({ mcpTemplates: value })}
          >
            {templateOptions.map((id) => (
              <Select.Option key={id} value={id}>
                {library.templates.find((template) => template.id === id)?.name ?? id}
              </Select.Option>
            ))}
          </Select>
          <span className='text-12px text-t-tertiary'>{t('mcp.kits.form.templatesHint')}</span>
        </div>
        {formError ? (
          <Alert type='error' content={t(`mcp.kits.form.errors.${formError}`, { max: KIT_NAME_MAX })} />
        ) : null}
      </div>
    </Modal>
  );
};

export default KitEditModal;
