/**
 * 金蝶 DMP 系统提交器
 *
 * 当前实现为通用 HTTP 适配器，实际字段映射需要根据 DMP 真实接口文档调整。
 * 技术人员可在 dmp-config.json 中配置：
 * - apiUrl
 * - headers（认证信息）
 * - fieldMapping（本地字段名 -> DMP 字段名）
 */
import * as https from 'https';
import * as http from 'http';
import { getDmpConfig } from './dmp-config';

export interface DmpSubmitData {
  title: string;
  description?: string;
  bug_type?: string;
  priority?: string;
  reporter_name?: string;
  assignee_name?: string;
  env_url?: string;
  imageDataUrl: string; // data:image/png;base64,...
}

export interface DmpSubmitResult {
  success: boolean;
  message: string;
  dmpBugId?: string | number;
}

/**
 * 将截图 dataURL 中的 base64 部分提取出来
 */
function stripBase64Prefix(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/png;base64,/, '');
}

export async function submitBugToDmp(data: DmpSubmitData): Promise<DmpSubmitResult> {
  const config = getDmpConfig();

  if (!config.enabled) {
    return { success: false, message: 'DMP 未启用（dmp-config.json 中 enabled 为 false 或文件不存在）' };
  }
  if (!config.apiUrl) {
    return { success: false, message: 'DMP 接口地址未配置' };
  }

  const mapping = config.fieldMapping;

  // 构造 DMP 请求体，字段名可通过 dmp-config.json 调整
  const payload: Record<string, any> = {};
  if (mapping.title) payload[mapping.title] = data.title;
  if (mapping.description && data.description) payload[mapping.description] = data.description;
  if (mapping.bugType && data.bug_type) payload[mapping.bugType] = data.bug_type;
  if (mapping.priority && data.priority) payload[mapping.priority] = data.priority;
  if (mapping.reporter && data.reporter_name) payload[mapping.reporter] = data.reporter_name;
  if (mapping.assignee && data.assignee_name) payload[mapping.assignee] = data.assignee_name;
  if (mapping.envUrl && data.env_url) payload[mapping.envUrl] = data.env_url;

  // 默认把截图以 base64 形式提交
  if (mapping.imageBase64) {
    payload[mapping.imageBase64] = stripBase64Prefix(data.imageDataUrl);
  }

  const body = JSON.stringify(payload);
  const urlObj = new URL(config.apiUrl);

  return new Promise((resolve) => {
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: config.method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...config.headers,
      },
    };

    const req = (urlObj.protocol === 'https:' ? https : http).request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          // 尝试解析返回中的 id 字段
          let dmpBugId: string | number | undefined;
          try {
            const parsed = JSON.parse(responseData);
            dmpBugId = parsed.id || parsed.bugId || parsed.data?.id;
          } catch {}
          resolve({ success: true, message: 'DMP 录入成功', dmpBugId });
        } else {
          resolve({ success: false, message: `DMP 接口返回错误 ${res.statusCode}: ${responseData.slice(0, 200)}` });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, message: `DMP 请求失败: ${err.message}` });
    });

    req.write(body);
    req.end();
  });
}
