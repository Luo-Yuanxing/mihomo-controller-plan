/** 界面常量读取：全局缓存，改 JSON 后由设置页"重载常量"刷新。 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { DEFAULT_UI_CONFIG, type UiConfig } from './types';

export function useUiConfig(): UiConfig {
  const query = useQuery({
    queryKey: ['ui-config'],
    queryFn: api.uiConfig,
    staleTime: Infinity,
  });
  return query.data?.config ?? DEFAULT_UI_CONFIG;
}
