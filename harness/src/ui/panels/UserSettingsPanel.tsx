import {
  makeStyles, tokens, Dropdown, Option, Input, Switch, Label, Textarea,
} from '@fluentui/react-components';
import { useHarnessStore } from '../../store/harness-store';
import { SUPPORTED_LCIDS } from '../../shim/user-settings';

const useStyles = makeStyles({
  root: {
    padding: '12px',
    overflowX: 'hidden',
    boxSizing: 'border-box',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  header: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  hint: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
});

const RTL_LCIDS = new Set([1025, 1037]); // ar-SA, he-IL

export function UserSettingsPanel() {
  const styles = useStyles();
  const userLanguageId = useHarnessStore(s => s.userLanguageId);
  const userIsRTL = useHarnessStore(s => s.userIsRTL);
  const userTimeZoneOffsetMinutes = useHarnessStore(s => s.userTimeZoneOffsetMinutes);
  const userId = useHarnessStore(s => s.userId);
  const userName = useHarnessStore(s => s.userName);
  const userSecurityRoles = useHarnessStore(s => s.userSecurityRoles);
  const setUserLanguageId = useHarnessStore(s => s.setUserLanguageId);
  const setUserIsRTL = useHarnessStore(s => s.setUserIsRTL);
  const setUserTimeZoneOffsetMinutes = useHarnessStore(s => s.setUserTimeZoneOffsetMinutes);
  const setUserId = useHarnessStore(s => s.setUserId);
  const setUserName = useHarnessStore(s => s.setUserName);
  const setUserSecurityRoles = useHarnessStore(s => s.setUserSecurityRoles);

  const onLanguageChange = (lcid: number) => {
    setUserLanguageId(lcid);
    setUserIsRTL(RTL_LCIDS.has(lcid));
  };

  const selectedLocale = SUPPORTED_LCIDS.find(l => l.lcid === userLanguageId);
  const selectedLabel = selectedLocale ? `${selectedLocale.locale} (${selectedLocale.lcid})` : `${userLanguageId}`;

  return (
    <div className={styles.root}>
      <div
        className={styles.header}
        title="User Settings — everything exposed via context.userSettings: language (LCID), time zone, RTL direction, user id/name, and security roles. Test how the control behaves for users in different locales or with different permissions without re-authenticating."
      >
        User Settings
      </div>

      <div className={styles.field}>
        <Label size="small" htmlFor="user-language" title="Language (LCID) — Windows locale identifier. 1033 = en-US, 1031 = de-DE, 1036 = fr-FR, etc. Drives context.userSettings.languageId, date/number formatting, and resx string lookup.">Language (LCID)</Label>
        <Dropdown
          id="user-language"
          size="small"
          selectedOptions={[String(userLanguageId)]}
          value={selectedLabel}
          onOptionSelect={(_, d) => d.optionValue && onLanguageChange(Number(d.optionValue))}
        >
          {SUPPORTED_LCIDS.map(({ lcid, locale }) => (
            <Option key={lcid} value={String(lcid)} text={`${locale} (${lcid})`}>
              {locale} ({lcid})
            </Option>
          ))}
        </Dropdown>
        <span className={styles.hint}>Drives context.userSettings.languageId and the locale used for date/number formatting.</span>
      </div>

      <div className={styles.field}>
        <Switch
          checked={userIsRTL}
          onChange={(_, d) => setUserIsRTL(d.checked)}
          label="Right-to-left (isRTL)"
          title="Right-to-left — when true, context.userSettings.isRTL = true and the page direction flips. Tests RTL layout for Arabic / Hebrew locales. Auto-enabled when an RTL language is picked."
        />
      </div>

      <div className={styles.field}>
        <Label size="small" htmlFor="user-tz" title="Time zone offset — minutes from UTC. 0 = UTC, -300 = US Eastern, 60 = Central European. Returned by context.userSettings.getTimeZoneOffsetMinutes(). Tests time-zone-sensitive rendering.">Time zone offset (minutes from UTC)</Label>
        <Input
          id="user-tz"
          size="small"
          type="number"
          value={String(userTimeZoneOffsetMinutes)}
          onChange={(_, d) => {
            const n = Number(d.value);
            if (Number.isFinite(n)) setUserTimeZoneOffsetMinutes(Math.round(n));
          }}
        />
        <span className={styles.hint}>e.g. 0 = UTC, -300 = EST, 60 = CET. Returned by getTimeZoneOffsetMinutes().</span>
      </div>

      <div className={styles.field}>
        <Label size="small" htmlFor="user-id" title="User ID — the GUID returned by context.userSettings.userId. Controls that record who-changed-what or filter records by owner use this. Keep the {braces} format consistent with real Dataverse user GUIDs.">User ID</Label>
        <Input
          id="user-id"
          size="small"
          value={userId}
          onChange={(_, d) => setUserId(d.value)}
        />
      </div>

      <div className={styles.field}>
        <Label size="small" htmlFor="user-name" title="User Name — context.userSettings.userName, the display name shown in user-facing chrome. Change this to test how the control renders different name lengths or non-ASCII characters.">User Name</Label>
        <Input
          id="user-name"
          size="small"
          value={userName}
          onChange={(_, d) => setUserName(d.value)}
        />
      </div>

      <div className={styles.field}>
        <Label size="small" htmlFor="user-roles" title="Security roles — names of the Dataverse security roles the current user holds. context.userSettings.securityRoles returns the list. Use this to test role-gated UI (admin-only buttons, etc.).">Security roles (one per line)</Label>
        <Textarea
          id="user-roles"
          size="small"
          rows={4}
          value={userSecurityRoles.join('\n')}
          onChange={(_, d) => setUserSecurityRoles(d.value.split('\n').map(r => r.trim()).filter(Boolean))}
        />
      </div>
    </div>
  );
}
