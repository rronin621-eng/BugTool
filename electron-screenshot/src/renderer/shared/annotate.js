/* annotate.js — 共享标注绘制模块
 * 供截图工具 (screenshot.js) 与组合编辑器 (combine.js) 共用。
 * 通过 window.AnnotateLib 暴露纯绘制函数，不依赖任何外部状态。
 */
(function () {
  'use strict';

  // 画箭头
  function drawArrow(ctx, x1, y1, x2, y2, lineWidth) {
    const headLen = Math.max(12, lineWidth * 4);
    const angle = Math.atan2(y2 - y1, x2 - x1);

    // 线段
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // 箭头头部
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  // 画自由画笔路径
  function drawPenPath(ctx, points, lineWidth) {
    if (!points || points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  }

  /**
   * 绘制单个标注。
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} ann 标注对象 { type, color, lineWidth, ... }
   * @param {boolean} [showTextBox=false] 文字标注是否绘制可拖拽虚线框
   */
  function drawAnnotation(ctx, ann, showTextBox) {
    ctx.save();
    ctx.strokeStyle = ann.color;
    ctx.fillStyle = ann.color;
    ctx.lineWidth = ann.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (ann.type === 'rect') {
      const rx = Math.min(ann.x1, ann.x2);
      const ry = Math.min(ann.y1, ann.y2);
      const rw = Math.abs(ann.x2 - ann.x1);
      const rh = Math.abs(ann.y2 - ann.y1);
      ctx.strokeRect(rx, ry, rw, rh);
    } else if (ann.type === 'arrow') {
      drawArrow(ctx, ann.x1, ann.y1, ann.x2, ann.y2, ann.lineWidth);
    } else if (ann.type === 'pen') {
      drawPenPath(ctx, ann.points, ann.lineWidth);
    } else if (ann.type === 'text') {
      const fontSize = Math.max(14, ann.lineWidth * 5);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillText(ann.text, ann.x, ann.y);
      // 文字工具模式下，绘制虚线包围框提示可拖拽
      if (showTextBox) {
        const textWidth = ctx.measureText(ann.text).width;
        ctx.save();
        ctx.strokeStyle = 'rgba(25, 118, 210, 0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(ann.x - 4, ann.y - fontSize - 2, textWidth + 8, fontSize + 6);
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  window.AnnotateLib = {
    drawArrow,
    drawPenPath,
    drawAnnotation,
  };
})();
