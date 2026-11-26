import { useSyncExternalStore } from "react";
import styles from "./ChristmasTrim.module.css";

const subscribe = () => () => {};
const serverSnapshot = () => false;

function isChristmasSeason() {
  const today = new Date();
  return today.getMonth() === 11 || (today.getMonth() === 10 && today.getDate() >= 26);
}

export default function ChristmasTrim({ animated = false }: { animated?: boolean }) {
  const visible = useSyncExternalStore(subscribe, isChristmasSeason, serverSnapshot);
  if (!visible) return null;

  return (
    <div aria-hidden="true" className={animated ? styles.login : styles.header}>
      <div className={styles.art}>
        {animated && (
          <iframe
            className={styles.player}
            src="/assets/santa-wave.html"
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            title="Father Christmas waving"
            tabIndex={-1}
          />
        )}
      </div>
    </div>
  );
}
