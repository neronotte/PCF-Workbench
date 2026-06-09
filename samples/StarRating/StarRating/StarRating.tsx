import * as React from 'react';
import {
  makeStyles,
  tokens,
  mergeClasses,
} from '@fluentui/react-components';

export interface IStarRatingProps {
  value: number | null;
  maxStars: number;
  allowClear: boolean;
  disabled: boolean;
  isAuthoringMode: boolean;
  onChange: (next: number | null) => void;
}

const useStyles = makeStyles({
  root: {
    display: 'inline-flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4px',
    padding: '4px',
    userSelect: 'none',
  },
  star: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    cursor: 'pointer',
    color: tokens.colorNeutralForeground3,
    transition: 'transform 80ms ease-out, color 80ms ease-out',
    backgroundColor: 'transparent',
    border: 'none',
    padding: '0',
    borderRadius: tokens.borderRadiusSmall,
    outlineOffset: '2px',
    ':hover': { transform: 'scale(1.1)' },
    ':focus-visible': {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
    },
  },
  filled: { color: tokens.colorBrandForeground1 },
  disabled: {
    color: tokens.colorNeutralForegroundDisabled,
    cursor: 'not-allowed',
    pointerEvents: 'none',
    ':hover': { transform: 'none' },
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200,
    padding: '4px 8px',
  },
  authoringLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    marginLeft: '8px',
  },
});

const StarIcon: React.FC<{ filled: boolean }> = ({ filled }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M12 2.5l2.9 6.3 6.6.7-4.9 4.6 1.4 6.6L12 17.4 6 20.7l1.4-6.6L2.5 9.5l6.6-.7L12 2.5z"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
);

export const StarRating: React.FC<IStarRatingProps> = (props) => {
  const styles = useStyles();
  const { maxStars, allowClear, disabled, isAuthoringMode, onChange } = props;

  // Clamp the displayed value per DESIGN §5 — render-only, no write-back.
  const rawValue = props.value ?? 0;
  const displayedValue = Math.max(0, Math.min(rawValue, maxStars));
  const [hover, setHover] = React.useState<number | null>(null);
  const [focusIdx, setFocusIdx] = React.useState<number>(() =>
    displayedValue > 0 ? displayedValue - 1 : 0,
  );

  if (maxStars <= 0 || maxStars > 20) {
    return <div className={styles.error}>Invalid maxStars: must be between 1 and 20</div>;
  }

  if (isAuthoringMode) {
    return (
      <div className={styles.root} aria-label="Rating control preview">
        {Array.from({ length: maxStars }).map((_, i) => (
          <span key={i} className={mergeClasses(styles.star, i < 3 && styles.filled)}>
            <StarIcon filled={i < 3} />
          </span>
        ))}
        <span className={styles.authoringLabel}>Rating control</span>
      </div>
    );
  }

  const previewValue = hover ?? displayedValue;

  const commit = (next: number): void => {
    if (disabled) return;
    if (allowClear && next === displayedValue) {
      onChange(0);
      setFocusIdx(0);
      return;
    }
    onChange(next);
    setFocusIdx(Math.max(0, next - 1));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return;
    const key = e.key;
    if (key === 'ArrowRight' || key === 'ArrowUp') {
      e.preventDefault();
      commit(Math.min(maxStars, displayedValue + 1));
    } else if (key === 'ArrowLeft' || key === 'ArrowDown') {
      e.preventDefault();
      const min = allowClear ? 0 : 1;
      commit(Math.max(min, displayedValue - 1));
    } else if (key === 'Home') {
      e.preventDefault();
      commit(1);
    } else if (key === 'End') {
      e.preventDefault();
      commit(maxStars);
    } else if (key === '0' && allowClear) {
      e.preventDefault();
      onChange(0);
      setFocusIdx(0);
    }
  };

  return (
    <div
      className={styles.root}
      role="radiogroup"
      aria-label={`Rating, 0 to ${maxStars} stars`}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      onMouseLeave={() => setHover(null)}
    >
      {Array.from({ length: maxStars }).map((_, i) => {
        const starValue = i + 1;
        const filled = starValue <= previewValue;
        const checked = starValue === displayedValue;
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`${starValue} ${starValue === 1 ? 'star' : 'stars'}`}
            title={
              displayedValue === 0
                ? 'Not rated'
                : `Rated ${displayedValue} of ${maxStars}`
            }
            tabIndex={disabled ? -1 : i === focusIdx ? 0 : -1}
            disabled={disabled}
            className={mergeClasses(
              styles.star,
              filled && styles.filled,
              disabled && styles.disabled,
            )}
            onMouseEnter={() => !disabled && setHover(starValue)}
            onFocus={() => setFocusIdx(i)}
            onClick={() => commit(starValue)}
            data-test-id={`star-${starValue}`}
          >
            <StarIcon filled={filled} />
          </button>
        );
      })}
    </div>
  );
};
