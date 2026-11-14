import { useThemeContext } from '@/renderer/hooks/context/ThemeContext';

/**
 * Border + focus glow of the chat input boxes. Inside a project surface the
 * project colour tokens (`--project-border`, `--project-focus`,
 * `--project-focus-shadow`, see ProjectIdentity/projectTheme.ts) take over, so
 * the send box carries the project accent; elsewhere the neutral values apply.
 */
export const useInputFocusRing = () => {
  const { theme } = useThemeContext();
  const isDarkTheme = theme === 'dark';

  const activeBorderColor = isDarkTheme ? '#4D4B87' : '#E1E0FF';
  const inactiveBorderColor = isDarkTheme ? '#3a3a4a' : '#c9cacf';
  const activeShadow = isDarkTheme ? '0px 2px 20px rgba(77, 75, 135, 0.45)' : '0px 2px 20px rgba(225, 224, 255, 0.6)';

  return {
    activeBorderColor: `var(--project-focus, ${activeBorderColor})`,
    inactiveBorderColor: `var(--project-border, ${inactiveBorderColor})`,
    activeShadow: `var(--project-focus-shadow, ${activeShadow})`,
  };
};
