"use client";

import { useEffect, useState } from "react";
import { ColumnCount } from "@/components/columns";
import {
  columnsKey,
  defaultShape,
  defaultShapeKey,
  isShapeFor,
  Shape,
  shapeKey,
  SurfaceId,
} from "./views";

/**
 * A screen's chosen shape and column count, read from the device.
 *
 * Storage is read after paint rather than during render: it cannot be touched
 * while prerendering, and reading it in an effect body would cascade a second
 * render on every mount.
 *
 * A pinned default (setDefault) wins over the shape last used, so a screen
 * you have an opinion about opens that way even after you borrow another
 * view; unpin it and the last used takes over again. Nothing is pinned until
 * you ask, which is why the screens nobody pins behave exactly as before.
 */
export function useSurfaceView(id: SurfaceId) {
  const [shape, setShapeState] = useState<Shape>(() => defaultShape(id));
  const [columns, setColumnsState] = useState<ColumnCount>(2);
  const [pinned, setPinned] = useState<Shape | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      const saved = window.localStorage.getItem(shapeKey(id));
      const asked = window.localStorage.getItem(defaultShapeKey(id));
      const pin = asked && isShapeFor(id, asked) ? asked : null;
      setPinned(pin);
      // the pin is an instruction about how this screen opens, so it beats
      // whatever shape happened to be left behind last time
      if (pin) setShapeState(pin);
      else if (saved && isShapeFor(id, saved)) setShapeState(saved);
      const savedCols = Number(window.localStorage.getItem(columnsKey(id)));
      if (savedCols === 1 || savedCols === 2 || savedCols === 3) setColumnsState(savedCols);
      setLoaded(true);
    });
  }, [id]);

  const setShape = (next: Shape) => {
    setShapeState(next);
    window.localStorage.setItem(shapeKey(id), next);
  };
  const setColumns = (next: ColumnCount) => {
    setColumnsState(next);
    window.localStorage.setItem(columnsKey(id), String(next));
  };
  /** Pin the shape on screen as this screen's default. */
  const setDefault = () => {
    setPinned(shape);
    window.localStorage.setItem(defaultShapeKey(id), shape);
  };
  /** Let the shape last used decide again. */
  const clearDefault = () => {
    setPinned(null);
    window.localStorage.removeItem(defaultShapeKey(id));
  };

  return { shape, setShape, columns, setColumns, loaded, pinned, isDefault: pinned === shape, setDefault, clearDefault };
}
