/**
 * 工作流库的**目录元数据**与随包内置的 3 份工作流正文。
 *
 * 9 条目录条目 = 本机 comfyui-2d-assets 技能里实测有效的 9 个游戏素材工作流：
 * 透明精灵 Turbo / 像素风 SDXL / 像素风 SDXL 极速 / 线稿控制 / 角色动作帧 /
 * BiRefNet 去背 / 像素化后处理 / 无缝地块 / 精灵表拼接。
 *
 * 按设计 §15 裁决 3：**只内置 3 份正文**（透明精灵 / 像素风 SDXL / BiRefNet 去背），
 * 其余 6 条只留目录元数据并标 `needsImport` —— 它们依赖的自定义节点与模型版本耦合太强，
 * 随包塞 6 份 JSON 只会让换机器的人拿到一份跑不起来的图；用户在设置页用
 * 「导入工作流」从本机 ComfyUI 的 `user/default/workflows/*.json` 导入即可
 * （界面格式与 API 格式都收，见 `workflowlib.saveWorkflow`）。
 *
 * **来源与再生成**：这 3 份正文由本机 ComfyUI 0.43.0 的界面格式导出文件转换而来
 * （节点 id → class_type / inputs，连线查 links，控件值按 /object_info 的输入顺序映射）。
 * 转换后用真实 /object_info 校验过：节点类型 0 缺失、模型文件 0 缺失。
 * 换机器后模型不同时，设置页自检会逐条列出缺失的模型与节点，不会静默失败。
 */
import type { WorkflowEntry, WorkflowKind } from "./workflowlib.js";

/** 一条目录元数据：没有正文的条目就是「需导入」。 */
export interface BuiltinCatalogEntry {
  id: string;
  name: string;
  purpose: string;
  kind: WorkflowKind;
  /** 依赖的模型文件名（自检提示用；不打包模型）。 */
  requiredModels: string[];
  defaults?: { width?: number; height?: number; steps?: number; cfg?: number; sampler?: string };
  /** 目录条目自带的推荐绑定（导入正文后可以直接沿用）。 */
  bindings?: Record<string, string>;
  notes?: string;
}

export const BUILTIN_CATALOG: BuiltinCatalogEntry[] = [
  {
    "id": "builtin.transparent-qwen",
    "name": "透明精灵 Turbo",
    "purpose": "高清透明精灵 / 角色立绘：Qwen Image 2.1 Turbo，8 步固定 sigma，直出带 alpha 的 PNG",
    "kind": "generate",
    "requiredModels": [
      "qwen_image_2.1_turbo_int8_convrot.safetensors",
      "qwen3vl_8b_int8_convrot.safetensors",
      "qwen_image_2.1_vae_bf16.safetensors"
    ],
    "defaults": {
      "width": 1024,
      "height": 1024,
      "sampler": "euler"
    },
    "bindings": {
      "prompt": "5.prompt",
      "negative": "5.negative_prompt",
      "width": "6.width",
      "height": "6.height",
      "seed": "9.noise_seed"
    }
  },
  {
    "id": "builtin.pixel-sdxl",
    "name": "像素风 SDXL",
    "purpose": "像素素材定稿：SDXL + pixel-art-xl + BiRefNet 去背 + 128px 像素化，25 步 dpmpp_2m / karras / cfg 7",
    "kind": "generate",
    "requiredModels": [
      "sd_xl_base_1.0.safetensors",
      "pixel-art-xl.safetensors",
      "birefnet.safetensors"
    ],
    "defaults": {
      "width": 1024,
      "height": 1024,
      "steps": 25,
      "cfg": 7,
      "sampler": "dpmpp_2m"
    },
    "bindings": {
      "prompt": "3.text",
      "negative": "4.text",
      "width": "5.width",
      "height": "5.height",
      "seed": "6.seed",
      "steps": "6.steps",
      "cfg": "6.cfg",
      "sampler": "6.sampler_name"
    }
  },
  {
    "id": "builtin.pixel-sdxl-fast",
    "name": "像素风 SDXL 极速",
    "purpose": "像素素材刷稿：8 步 LCM / sgm_uniform / cfg 1.5，全流程约 8 秒（需先导入）",
    "kind": "generate",
    "requiredModels": [
      "sd_xl_base_1.0.safetensors",
      "pixel-art-xl.safetensors",
      "lcm-lora-sdxl.safetensors",
      "birefnet.safetensors"
    ],
    "defaults": {
      "width": 1024,
      "height": 1024,
      "steps": 8,
      "cfg": 1.5,
      "sampler": "lcm"
    },
    "bindings": {
      "prompt": "3.text",
      "negative": "4.text",
      "width": "5.width",
      "height": "5.height",
      "seed": "6.seed"
    }
  },
  {
    "id": "builtin.lineart-control",
    "name": "线稿控制",
    "purpose": "按线稿 / 边缘控制出图：Qwen Turbo + ControlNet Union int8，strength 1.0（需先导入）",
    "kind": "generate",
    "requiredModels": [
      "qwen_image_2.1_turbo_int8_convrot.safetensors",
      "qwen3vl_8b_int8_convrot.safetensors",
      "qwen_image_2.1_vae_bf16.safetensors",
      "qwen_image_2.1_fun_controlnet_union_int8_convrot.safetensors"
    ],
    "defaults": {
      "width": 1024,
      "height": 1024
    },
    "bindings": {
      "prompt": "5.prompt",
      "image": "1.image"
    }
  },
  {
    "id": "builtin.pose-frame",
    "name": "角色动作帧",
    "purpose": "按姿势图出单帧动作：参考图 + pose 图双输入，ControlNet strength 0.55（需先导入）",
    "kind": "generate",
    "requiredModels": [
      "qwen_image_2.1_turbo_int8_convrot.safetensors",
      "qwen3vl_8b_int8_convrot.safetensors",
      "qwen_image_2.1_vae_bf16.safetensors",
      "qwen_image_2.1_fun_controlnet_union_int8_convrot.safetensors"
    ],
    "defaults": {
      "width": 1024,
      "height": 1024
    },
    "bindings": {
      "prompt": "5.prompt",
      "image": "1.image",
      "image2": "2.image"
    }
  },
  {
    "id": "builtin.matte-birefnet",
    "name": "BiRefNet 去背",
    "purpose": "任意图去背：RemoveBackground → InvertMask → JoinImageWithAlpha，输出带 alpha 的 PNG",
    "kind": "post",
    "requiredModels": [
      "birefnet.safetensors"
    ],
    "bindings": {
      "image": "1.image"
    }
  },
  {
    "id": "builtin.pixelize-post",
    "name": "像素化后处理",
    "purpose": "现图转像素：ImageScale(area) → ImageQuantize(24 色) → 还原 alpha → 128px（需先导入）",
    "kind": "post",
    "requiredModels": [],
    "bindings": {
      "image": "1.image",
      "width": "3.width",
      "height": "3.height"
    }
  },
  {
    "id": "builtin.tile-seamless",
    "name": "无缝地块",
    "purpose": "可平铺地块：SeamlessTile + MakeCircularVAE 同时 enable，20 步 dpmpp_2m（需先导入）",
    "kind": "generate",
    "requiredModels": [
      "sd_xl_base_1.0.safetensors",
      "pixel-art-xl.safetensors"
    ],
    "defaults": {
      "width": 1024,
      "height": 1024,
      "steps": 20,
      "cfg": 7,
      "sampler": "dpmpp_2m"
    },
    "bindings": {
      "prompt": "3.text",
      "width": "5.width",
      "height": "5.height",
      "seed": "6.seed"
    }
  },
  {
    "id": "builtin.sprite-grid",
    "name": "精灵表拼接",
    "purpose": "多帧拼一张精灵表：4 帧 → 256 → ImageBatch → ImageGrid(4 列)（需先导入）",
    "kind": "post",
    "requiredModels": [],
    "bindings": {
      "image": "1.image",
      "batch": "6.columns"
    }
  }
];

/** 随包内置正文的 3 份（其余目录条目等待用户从本机导入）。 */
export const BUILTIN_WORKFLOWS: WorkflowEntry[] = [
  {
    "id": "builtin.transparent-qwen",
    "name": "透明精灵 Turbo",
    "purpose": "高清透明精灵 / 角色立绘：Qwen Image 2.1 Turbo，8 步固定 sigma，直出带 alpha 的 PNG",
    "kind": "generate",
    "protocol": "ui",
    "builtin": true,
    "requiredModels": [
      "qwen_image_2.1_turbo_int8_convrot.safetensors",
      "qwen3vl_8b_int8_convrot.safetensors",
      "qwen_image_2.1_vae_bf16.safetensors"
    ],
    "bindings": {
      "prompt": "5.prompt",
      "negative": "5.negative_prompt",
      "width": "6.width",
      "height": "6.height",
      "seed": "9.noise_seed"
    },
    "defaults": {
      "width": 1024,
      "height": 1024,
      "sampler": "euler"
    },
    "notes": "来自本机 ComfyUI user\\default\\workflows\\游戏素材_透明精灵_Turbo.json（界面格式转 API 格式）。提示词与尺寸会被注入覆盖。",
    "workflow": {
      "1": {
        "class_type": "UNETLoader",
        "inputs": {
          "unet_name": "qwen_image_2.1_turbo_int8_convrot.safetensors",
          "weight_dtype": "default"
        }
      },
      "2": {
        "class_type": "QwenImage21Cache",
        "inputs": {
          "model": [
            "1",
            0
          ],
          "device": "auto",
          "dtype": "default"
        }
      },
      "3": {
        "class_type": "CLIPLoader",
        "inputs": {
          "clip_name": "qwen3vl_8b_int8_convrot.safetensors",
          "type": "qwen_image",
          "device": "default"
        }
      },
      "4": {
        "class_type": "VAELoader",
        "inputs": {
          "vae_name": "qwen_image_2.1_vae_bf16.safetensors"
        }
      },
      "5": {
        "class_type": "TextEncodeQwenImage21",
        "inputs": {
          "clip": [
            "3",
            0
          ],
          "prompt": "This is an RGBA format image with transparency. A single 2D game asset sprite of a cute green slime monster, top-down 3/4 view, clean thick cartoon outlines, flat cel shading, readable silhouette, centered, full body, no ground shadow, no text, isolated on transparent background. The image has an alpha channel and a transparent background.",
          "negative_prompt": "",
          "resolution": 1024,
          "images": "This is an RGBA format image with transparency. A single 2D game asset sprite of a cute green slime monster, top-down 3/4 view, clean thick cartoon outlines, flat cel shading, readable silhouette, centered, full body, no ground shadow, no text, isolated on transparent background. The image has an alpha channel and a transparent background."
        }
      },
      "6": {
        "class_type": "EmptyLatentImage",
        "inputs": {
          "width": 1024,
          "height": 1024,
          "batch_size": 1
        }
      },
      "7": {
        "class_type": "ManualSigmas",
        "inputs": {
          "sigmas": "1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0"
        }
      },
      "8": {
        "class_type": "KSamplerSelect",
        "inputs": {
          "sampler_name": "euler"
        }
      },
      "9": {
        "class_type": "RandomNoise",
        "inputs": {
          "noise_seed": 20261018
        }
      },
      "10": {
        "class_type": "CFGGuider",
        "inputs": {
          "model": [
            "2",
            0
          ],
          "positive": [
            "5",
            0
          ],
          "negative": [
            "5",
            1
          ],
          "cfg": 1
        }
      },
      "11": {
        "class_type": "SamplerCustomAdvanced",
        "inputs": {
          "noise": [
            "9",
            0
          ],
          "guider": [
            "10",
            0
          ],
          "sampler": [
            "8",
            0
          ],
          "sigmas": [
            "7",
            0
          ],
          "latent_image": [
            "6",
            0
          ]
        }
      },
      "12": {
        "class_type": "VAEDecode",
        "inputs": {
          "samples": [
            "11",
            0
          ],
          "vae": [
            "4",
            0
          ]
        }
      },
      "13": {
        "class_type": "SaveImage",
        "inputs": {
          "images": [
            "12",
            0
          ],
          "filename_prefix": "game-assets/sprites/sprite"
        }
      }
    },
    "createdAt": 0,
    "updatedAt": 0
  },
  {
    "id": "builtin.pixel-sdxl",
    "name": "像素风 SDXL",
    "purpose": "像素素材定稿：SDXL + pixel-art-xl + BiRefNet 去背 + 128px 像素化，25 步 dpmpp_2m / karras / cfg 7",
    "kind": "generate",
    "protocol": "ui",
    "builtin": true,
    "requiredModels": [
      "sd_xl_base_1.0.safetensors",
      "pixel-art-xl.safetensors",
      "birefnet.safetensors"
    ],
    "bindings": {
      "prompt": "3.text",
      "negative": "4.text",
      "width": "5.width",
      "height": "5.height",
      "seed": "6.seed",
      "steps": "6.steps",
      "cfg": "6.cfg",
      "sampler": "6.sampler_name"
    },
    "defaults": {
      "width": 1024,
      "height": 1024,
      "steps": 25,
      "cfg": 7,
      "sampler": "dpmpp_2m"
    },
    "notes": "来自游戏素材_像素风_SDXL.json。工作流自带 BiRefNet 去背与 128px 像素化两步后处理。",
    "workflow": {
      "1": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {
          "ckpt_name": "sd_xl_base_1.0.safetensors"
        }
      },
      "2": {
        "class_type": "LoraLoader",
        "inputs": {
          "model": [
            "1",
            0
          ],
          "clip": [
            "1",
            1
          ],
          "lora_name": "pixel-art-xl.safetensors",
          "strength_model": 1,
          "strength_clip": 1
        }
      },
      "3": {
        "class_type": "CLIPTextEncode",
        "inputs": {
          "clip": [
            "2",
            1
          ],
          "text": "pixel art, a cute green slime monster with big eyes, simple flat colors, clean outlines, solid light background, 16-bit game sprite"
        }
      },
      "4": {
        "class_type": "CLIPTextEncode",
        "inputs": {
          "clip": [
            "2",
            1
          ],
          "text": "blurry, smooth gradients, 3d render, realistic, photo, text, watermark, noisy"
        }
      },
      "5": {
        "class_type": "EmptyLatentImage",
        "inputs": {
          "width": 1024,
          "height": 1024,
          "batch_size": 1
        }
      },
      "6": {
        "class_type": "KSampler",
        "inputs": {
          "model": [
            "2",
            0
          ],
          "positive": [
            "3",
            0
          ],
          "negative": [
            "4",
            0
          ],
          "latent_image": [
            "5",
            0
          ],
          "seed": 20261018,
          "steps": 25,
          "cfg": 7,
          "sampler_name": "dpmpp_2m",
          "scheduler": "karras",
          "denoise": 1
        }
      },
      "7": {
        "class_type": "VAEDecode",
        "inputs": {
          "samples": [
            "6",
            0
          ],
          "vae": [
            "1",
            2
          ]
        }
      },
      "8": {
        "class_type": "SaveImage",
        "inputs": {
          "images": [
            "7",
            0
          ],
          "filename_prefix": "game-assets/pixel/sdxl_pixel_raw"
        }
      },
      "9": {
        "class_type": "LoadBackgroundRemovalModel",
        "inputs": {
          "bg_removal_name": "birefnet.safetensors"
        }
      },
      "10": {
        "class_type": "RemoveBackground",
        "inputs": {
          "bg_removal_model": [
            "9",
            0
          ],
          "image": [
            "7",
            0
          ]
        }
      },
      "11": {
        "class_type": "InvertMask",
        "inputs": {
          "mask": [
            "10",
            0
          ]
        }
      },
      "12": {
        "class_type": "ImageScale",
        "inputs": {
          "image": [
            "7",
            0
          ],
          "upscale_method": "area",
          "width": 128,
          "height": 128,
          "crop": "disabled"
        }
      },
      "13": {
        "class_type": "ImageQuantize",
        "inputs": {
          "image": [
            "12",
            0
          ],
          "colors": 24,
          "dither": "none"
        }
      },
      "14": {
        "class_type": "MaskToImage",
        "inputs": {
          "mask": [
            "11",
            0
          ]
        }
      },
      "15": {
        "class_type": "ImageScale",
        "inputs": {
          "image": [
            "14",
            0
          ],
          "upscale_method": "area",
          "width": 128,
          "height": 128,
          "crop": "disabled"
        }
      },
      "16": {
        "class_type": "ImageToMask",
        "inputs": {
          "image": [
            "15",
            0
          ],
          "channel": "red"
        }
      },
      "17": {
        "class_type": "JoinImageWithAlpha",
        "inputs": {
          "image": [
            "13",
            0
          ],
          "alpha": [
            "16",
            0
          ]
        }
      },
      "18": {
        "class_type": "SaveImage",
        "inputs": {
          "images": [
            "17",
            0
          ],
          "filename_prefix": "game-assets/pixel/sdxl_pixel_128"
        }
      }
    },
    "createdAt": 0,
    "updatedAt": 0
  },
  {
    "id": "builtin.matte-birefnet",
    "name": "BiRefNet 去背",
    "purpose": "任意图去背：RemoveBackground → InvertMask → JoinImageWithAlpha，输出带 alpha 的 PNG",
    "kind": "post",
    "protocol": "ui",
    "builtin": true,
    "requiredModels": [
      "birefnet.safetensors"
    ],
    "bindings": {
      "image": "1.image"
    },
    "notes": "来自游戏素材_抠图透明化_BiRefNet.json。输入图与输出图必须同尺寸（插件侧会核对）。",
    "workflow": {
      "1": {
        "class_type": "LoadImage",
        "inputs": {
          "image": "test_slime.png"
        }
      },
      "2": {
        "class_type": "LoadBackgroundRemovalModel",
        "inputs": {
          "bg_removal_name": "birefnet.safetensors"
        }
      },
      "3": {
        "class_type": "RemoveBackground",
        "inputs": {
          "bg_removal_model": [
            "2",
            0
          ],
          "image": [
            "1",
            0
          ]
        }
      },
      "4": {
        "class_type": "InvertMask",
        "inputs": {
          "mask": [
            "3",
            0
          ]
        }
      },
      "5": {
        "class_type": "JoinImageWithAlpha",
        "inputs": {
          "image": [
            "1",
            0
          ],
          "alpha": [
            "4",
            0
          ]
        }
      },
      "6": {
        "class_type": "SaveImage",
        "inputs": {
          "images": [
            "5",
            0
          ],
          "filename_prefix": "game-assets/cutout/asset"
        }
      }
    },
    "createdAt": 0,
    "updatedAt": 0
  }
];
