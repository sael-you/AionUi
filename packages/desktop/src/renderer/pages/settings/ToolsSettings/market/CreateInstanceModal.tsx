/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Add an instance from a template, or duplicate an instance. The name follows
 * the server's rules (shown, checked as you type, and the server's 409/400 is
 * shown as is). From a template: environment, tier, CLIs, the plain env values
 * and the secrets (write-only). A duplicate copies everything but the secrets,
 * on the server; it starts dormant.
 */

import { Alert, Checkbox, Input, Message, Modal, Radio, Select } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { McpMarketInstance, McpMarketTemplate } from '@/common/config/storage';
import {
  MCP_INSTANCE_NAME_MAX,
  MCP_MARKET_ENVIRONMENTS,
  McpMarketSecretsNotSavedError,
  describeMarketError,
  forcedPlainEnv,
  instanceNameProblem,
  isMaskedValue,
  plainKeys,
  secretKeys,
  templateClisForTier,
} from '@/renderer/hooks/mcp/market/marketModel';
import type { McpMarketController } from '@/renderer/hooks/mcp/market/useMcpMarket';
import SecretField from './SecretField';
import { touchClass, useIsMobileLayout } from './shared';

export type CreateInstanceTarget =
  { kind: 'template'; template: McpMarketTemplate } | { kind: 'duplicate'; source: McpMarketInstance };

type CreateInstanceModalProps = {
  target: CreateInstanceTarget | null;
  takenNames: readonly string[];
  market: Pick<McpMarketController, 'createInstance' | 'duplicateInstance'>;
  onClose: () => void;
  onCreated: (instance: McpMarketInstance) => void;
};

const Field: React.FC<{ label: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode }> = ({
  label,
  htmlFor,
  hint,
  children,
}) => (
  <div className='flex flex-col gap-6px'>
    <label className='text-13px text-t-primary font-medium' htmlFor={htmlFor}>
      {label}
    </label>
    {children}
    {hint}
  </div>
);

const initialPlainEnv = (template: McpMarketTemplate, tier: string): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const key of plainKeys(template)) {
    const value = template.env[key].default;
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...forcedPlainEnv(template, tier) };
};

const CreateInstanceModal: React.FC<CreateInstanceModalProps> = ({
  target,
  takenNames,
  market,
  onClose,
  onCreated,
}) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const template = target?.kind === 'template' ? target.template : null;
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState<string | undefined>(undefined);
  const [tier, setTier] = useState('');
  const [clis, setClis] = useState<string[]>([]);
  const [plainEnv, setPlainEnv] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset for every target; secret drafts never survive a close.
  useEffect(() => {
    setName('');
    setTouched(false);
    setError(null);
    setSecrets({});
    if (template) {
      const firstTier = template.tiers[0] ?? '';
      setTier(firstTier);
      setEnvironment(undefined);
      setClis(templateClisForTier(template, firstTier));
      setPlainEnv(initialPlainEnv(template, firstTier));
    }
  }, [target, template]);

  const nameProblem = instanceNameProblem(name.trim(), takenNames);
  const forced = useMemo(() => (template ? forcedPlainEnv(template, tier) : {}), [template, tier]);
  const tierClis = useMemo(() => (template ? templateClisForTier(template, tier) : []), [template, tier]);
  const missingPlain = template
    ? plainKeys(template).filter((key) => template.env[key].required && !(plainEnv[key] ?? '').trim())
    : [];
  const maskedSecret = Object.values(secrets).some(isMaskedValue);
  const formProblem =
    nameProblem !== null || (template !== null && (!environment || !tier || clis.length === 0 || maskedSecret));

  if (!target) return null;

  const changeTier = (next: string) => {
    if (!template) return;
    setTier(next);
    const allowed = templateClisForTier(template, next);
    setClis((prev) => prev.filter((cli) => allowed.includes(cli)));
    setPlainEnv((prev) => ({ ...prev, ...forcedPlainEnv(template, next) }));
  };

  const submit = async () => {
    setTouched(true);
    if (formProblem) return;
    setBusy(true);
    setError(null);
    const trimmed = name.trim();
    try {
      if (target.kind === 'duplicate') {
        onCreated(await market.duplicateInstance(target.source.id, trimmed));
      } else {
        const env = Object.fromEntries(Object.entries(plainEnv).filter(([, v]) => v.trim() !== ''));
        const created = await market.createInstance(
          {
            name: trimmed,
            template_id: target.template.id,
            environment: environment!,
            tier,
            clis,
            plain_env: env,
            // Read = allowlist, fail closed: no tool until one is allowed after a test (R6).
            ...(tier === 'read' ? { tools_allow: [] } : { tools_block: [] }),
          },
          secrets
        );
        setSecrets({});
        onCreated(created);
      }
    } catch (err) {
      if (err instanceof McpMarketSecretsNotSavedError) {
        // The instance exists: close as created (the drawer opens on it) and
        // say which secrets still have to be set there. A retry here would
        // only hit "name taken".
        setSecrets({});
        Message.warning({
          content: t('mcp.market.create.secretsNotSaved', { name: err.instance.name, keys: err.keys.join(', ') }),
          duration: 10000,
        });
        onCreated(err.instance);
        return;
      }
      setError(describeMarketError(t, err, 'name'));
    } finally {
      setBusy(false);
    }
  };

  const title =
    target.kind === 'duplicate'
      ? t('mcp.market.create.duplicateTitle', { name: target.source.name })
      : t('mcp.market.create.title', { name: target.template.name });

  return (
    <Modal
      visible
      title={title}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={target.kind === 'duplicate' ? t('mcp.market.actions.duplicate') : t('mcp.market.actions.create')}
      cancelText={t('mcp.market.actions.cancel')}
      confirmLoading={busy}
      okButtonProps={{ disabled: touched && formProblem, className: touchClass(isMobile) }}
      cancelButtonProps={{ className: touchClass(isMobile) }}
      style={isMobile ? { width: '100%', top: 0 } : { width: 560 }}
      unmountOnExit
    >
      <div className='flex flex-col gap-16px' data-testid='mcp-market-create'>
        <Field
          label={t('mcp.market.create.name')}
          htmlFor='mcp-market-name'
          hint={
            <>
              <span id='mcp-market-name-rules' className='text-12px text-t-secondary'>
                {t('mcp.market.create.nameRules', { max: MCP_INSTANCE_NAME_MAX })}
              </span>
              {touched && nameProblem && (
                <span role='alert' className='text-12px text-danger'>
                  {t(`mcp.market.create.nameProblem.${nameProblem}`, { max: MCP_INSTANCE_NAME_MAX })}
                </span>
              )}
            </>
          }
        >
          <Input
            id='mcp-market-name'
            value={name}
            onChange={(v) => setName(v.toLowerCase())}
            onBlur={() => setTouched(true)}
            maxLength={MCP_INSTANCE_NAME_MAX}
            autoComplete='off'
            aria-describedby='mcp-market-name-rules'
            status={touched && nameProblem ? 'error' : undefined}
            className={touchClass(isMobile)}
          />
        </Field>

        {target.kind === 'duplicate' && <Alert type='info' content={t('mcp.market.create.duplicateNote')} />}

        {template && (
          <>
            {template.description && <p className='m-0 text-13px text-t-secondary'>{template.description}</p>}
            <Field label={t('mcp.market.create.environment')}>
              <Select
                value={environment}
                onChange={setEnvironment}
                placeholder={t('mcp.market.create.environmentPlaceholder')}
                status={touched && !environment ? 'error' : undefined}
                className={touchClass(isMobile)}
              >
                {MCP_MARKET_ENVIRONMENTS.map((env) => (
                  <Select.Option key={env} value={env}>
                    {t(`mcp.market.environment.${env}`, { defaultValue: env })}
                  </Select.Option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('mcp.market.create.tier')}
              hint={
                tier === 'write' ? (
                  <Alert type='warning' content={t('mcp.market.create.writeTierNote')} />
                ) : (
                  <span className='text-12px text-t-secondary'>{t('mcp.market.create.readTierNote')}</span>
                )
              }
            >
              <Radio.Group type='button' value={tier} onChange={changeTier}>
                {template.tiers.map((x) => (
                  <Radio key={x} value={x} className={touchClass(isMobile)}>
                    {t(`mcp.market.tier.${x}`, { defaultValue: x })}
                  </Radio>
                ))}
              </Radio.Group>
            </Field>
            <Field label={t('mcp.market.create.clis')}>
              <Checkbox.Group value={clis} onChange={(v) => setClis(v as string[])}>
                {template.clis.map((cli) => (
                  <Checkbox key={cli} value={cli} disabled={!tierClis.includes(cli)}>
                    {t(`mcp.market.cli.${cli}`, { defaultValue: cli })}
                  </Checkbox>
                ))}
              </Checkbox.Group>
            </Field>

            {plainKeys(template).length > 0 && (
              <div className='flex flex-col gap-12px'>
                <div className='text-13px text-t-primary font-medium'>{t('mcp.market.create.plainEnv')}</div>
                {plainKeys(template).map((key) => {
                  const field = template.env[key];
                  const isForced = key in forced;
                  const id = `mcp-market-env-${key}`;
                  return (
                    <Field
                      key={key}
                      label={field.required ? `${key} *` : key}
                      htmlFor={id}
                      hint={
                        <span className='text-12px text-t-secondary'>
                          {isForced ? t('mcp.market.create.forcedByTier', { tier }) : field.description}
                        </span>
                      }
                    >
                      {field.enum && field.enum.length > 0 ? (
                        <Select
                          id={id}
                          value={plainEnv[key]}
                          disabled={isForced}
                          allowClear={!field.required}
                          onChange={(v: string | undefined) => setPlainEnv((prev) => ({ ...prev, [key]: v ?? '' }))}
                          className={touchClass(isMobile)}
                        >
                          {field.enum.map((option) => (
                            <Select.Option key={option} value={option}>
                              {option}
                            </Select.Option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          id={id}
                          value={plainEnv[key] ?? ''}
                          disabled={isForced}
                          onChange={(v) => setPlainEnv((prev) => ({ ...prev, [key]: v }))}
                          autoComplete='off'
                          className={touchClass(isMobile)}
                        />
                      )}
                    </Field>
                  );
                })}
              </div>
            )}

            {secretKeys(template).length > 0 && (
              <div className='flex flex-col gap-12px'>
                <div className='text-13px text-t-primary font-medium'>{t('mcp.market.create.secrets')}</div>
                {secretKeys(template).map((key) => (
                  <SecretField
                    key={key}
                    mode='create'
                    secretKey={key}
                    required={template.env[key].required === true}
                    description={template.env[key].description}
                    value={secrets[key] ?? ''}
                    onChange={(v) => setSecrets((prev) => ({ ...prev, [key]: v }))}
                  />
                ))}
              </div>
            )}

            {missingPlain.length > 0 && (
              <span className='text-12px text-t-secondary'>
                {t('mcp.market.create.dormantUntilComplete', { keys: missingPlain.join(', ') })}
              </span>
            )}
            <span className='text-12px text-t-secondary'>{t('mcp.market.create.startsDormant')}</span>
          </>
        )}

        {error && <Alert type='error' content={error} />}
      </div>
    </Modal>
  );
};

export default CreateInstanceModal;
