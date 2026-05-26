import { Node, mergeAttributes } from "@tiptap/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useApp } from "@/lib/store";

// Inline atomic node — renders as a chip "[round-thumb] 图片N".
// On serialize-to-text it becomes "(图N)" so Claude reads the canonical marker.
export const ImageBadge = Node.create({
  name: "imageBadge",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      imageId: { default: null },
      imageIndex: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-image-badge="true"]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return null;
          return {
            imageId: Number(el.getAttribute("data-image-id")) || null,
            imageIndex: Number(el.getAttribute("data-image-index")) || null,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-image-badge": "true",
        "data-image-id": HTMLAttributes.imageId,
        "data-image-index": HTMLAttributes.imageIndex,
        class: "vellum-img-badge",
      }),
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.contentEditable = "false";
      dom.setAttribute("data-image-badge", "true");
      dom.setAttribute("data-image-id", String(node.attrs.imageId));
      dom.setAttribute("data-image-index", String(node.attrs.imageIndex));
      dom.className = "vellum-img-badge";

      const refImages = useApp.getState().refImages;
      const ref = refImages.find((r) => r.id === node.attrs.imageId);

      const img = document.createElement("img");
      img.alt = "";
      img.draggable = false;
      img.className = "vellum-img-badge-thumb";
      if (ref) {
        img.src = convertFileSrc(ref.file_path);
      }

      const label = document.createElement("span");
      label.className = "vellum-img-badge-label";
      label.textContent = `图片${node.attrs.imageIndex}`;

      dom.append(img, label);
      return { dom };
    };
  },
});
