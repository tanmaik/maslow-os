"use client";

import { useEffect, useState } from "react";

import { Row } from "@/app/settings/row";
import { Switch } from "@/components/base/switch/switch";
import {
  askLocation,
  locationIsOn,
  turnLocationOff,
} from "@/components/location";

// The one row Location and weather is: on once the browser has granted
// it, off by default and once it is refused. Turning it on asks the
// browser again; turning it off never does, until this is switched back
// on.
export function LocationRow() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(locationIsOn()), []);
  return (
    <Row label="Location and weather">
      <Switch
        size="sm"
        aria-label="Location and weather"
        isSelected={on}
        onChange={(to) => {
          if (!to) {
            setOn(false);
            turnLocationOff();
            return;
          }
          void askLocation().then(setOn);
        }}
      />
    </Row>
  );
}
