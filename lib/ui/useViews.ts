"use client";

import { useEffect, useState } from "react";
import { ColumnCount } from "@/components/columns";
import {
  columnsKey,
  defaultShape,
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
 */
export function useSurfaceView(id: SurfaceId) {
  const [shape, setShapeState] = useState<Shape>(() => defaultShape(id));
  const [columns, setColumnsState] = useState<ColumnCount>(2);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      const savedShape = window.localStorage.getItem(shapeKey(id));
      if (savedShape && isShapeFor(id, savedShape)) setShapeState(savedShape);
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

  return { shape, setShape, columns, setColumns, loaded };
}
