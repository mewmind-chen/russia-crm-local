#!/usr/bin/env python3
"""
客户采购需求检查脚本 (Customer Purchase Demand Checker)

用途：分析俄罗斯客户的电子元器件采购需求
评分规则：v3.0 (全球品牌识别 + 型号前缀匹配)

核心洞察：华强北 = 全球元器件超市，客户用任何品牌都是需求信号

检查方法：
  1. UN Comtrade API - 俄罗斯从中国进口记录（HS Code电子元器件）
  2. elcp.ru合同检查 - 公开合同供应商信息
  3. 官网配件页检查 - 搜索全球元器件品牌 + 型号前缀

输出：
  - JSON: 需求详情
  - Markdown: 可读报告
  - CSV: 批量检查结果

Usage:
  python3 check_china_purchase.py --inn 7704736686 --name "Ростех"
  python3 check_china_purchase.py --company "ЧПУ24" --website "chpu24.com"
  python3 check_china_purchase.py --batch customers.csv
"""

import subprocess
import json
import re
import argparse
import csv
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List
import sys

# 导入全球品牌库
try:
    from brands_database import (
        GLOBAL_BRANDS, MODEL_PREFIXES, CATEGORY_KEYWORDS,
        RUSSIAN_KEYWORDS, CHINA_CITY_KEYWORDS, list_all_keywords
    )
    BRANDS_LOADED = True
except ImportError:
    BRANDS_LOADED = False
    # 兜底：保留原有中国品牌定义
    GLOBAL_BRANDS = {}
    MODEL_PREFIXES = {}
    CATEGORY_KEYWORDS = {}

# 配置
LIGHTPANDA_BIN = Path.home() / ".local/bin/lightpanda"
PROXY = "http://127.0.0.1:7897"
OUTPUT_DIR = Path.home() / ".hermes/workspace/demand_reports"

# HS Code 电子元器件分类
HS_CODES_ELECTRONICS = {
    "8542": "电子集成电路 (Integrated Circuits)",
    "8534": "印制电路 (Printed Circuits)",
    "8541": "半导体器件 (Semiconductor Devices)",
    "8536": "电气装置 (Electrical Apparatus)",
    "8537": "电气控制或配电装置 (Electrical Control Panels)",
    "8544": "绝缘电线电缆 (Insulated Wire/Cable)",
    "8501": "电动机 (Electric Motors)",
    "8504": "变压器/整流器 (Transformers/Rectifiers)",
    "8518": "音频设备 (Audio Equipment)",
    "8525": "无线电传输设备 (Radio Transmission)",
    "8527": "无线电接收设备 (Radio Reception)",
    "8528": "电视接收设备 (TV Reception)",
    "8540": "热电子管/阴极射线管 (Thermionic Tubes)",
}

class ChinaPurchaseChecker:
    def __init__(self, comtrade_api_key: Optional[str] = None):
        self.api_key = comtrade_api_key
        self.results = {
            "company": None,
            "inn": None,
            "website": None,
            "check_time": datetime.now().isoformat(),
            "evidence": {
                "comtrade": {"score": 0, "found": False, "details": []},
                "elcp": {"score": 0, "found": False, "details": []},
                "website": {"score": 0, "found": False, "details": []},
            },
            "total_score": 0,
            "recommendation": None,
        }
        
    def fetch_with_lightpanda(self, url: str, timeout: int = 30) -> Optional[str]:
        """使用Lightpanda抓取页面"""
        if not LIGHTPANDA_BIN.exists():
            print(f"⚠️ Lightpanda未安装: {LIGHTPANDA_BIN}")
            return None
            
        cmd = [
            str(LIGHTPANDA_BIN),
            "fetch",
            "--dump", "markdown",
            "--wait-until", "networkidle",
            "--http-proxy", PROXY,
            "--http-timeout", str(timeout * 1000),
            url
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 10)
            if result.returncode != 0:
                print(f"⚠️ Lightpanda错误: {result.stderr[:200]}")
                return None
            return result.stdout
        except subprocess.TimeoutExpired:
            print(f"⚠️ Lightpanda超时: {url}")
            return None
        except Exception as e:
            print(f"⚠️ 抓取失败: {e}")
            return None
    
    def check_comtrade(self, inn: str, company_name: str) -> Dict:
        """
        检查UN Comtrade数据：俄罗斯从中国进口电子元器件记录
        
        注意：API已验证可用，俄罗斯2021年数据完整
        使用API Key可获取更多数据（250K条限制）
        """
        print(f"\n📊 [1/3] 检查UN Comtrade海关数据...")
        
        evidence = {"score": 0, "found": False, "details": []}
        
        try:
            import comtradeapicall
            
            # 查询俄罗斯从中国进口的电子元器件（2021年数据最完整）
            total_china_import = 0
            found_hs_codes = []
            
            for hs_code, hs_desc in HS_CODES_ELECTRONICS.items():
                try:
                    # 使用年度数据（2021年俄罗斯数据完整）
                    if self.api_key:
                        df = comtradeapicall.getFinalData(
                            self.api_key,
                            typeCode='C', freqCode='A', clCode='HS', period='2021',
                            reporterCode='643',  # 俄罗斯
                            partnerCode='156',   # 中国
                            cmdCode=hs_code,
                            flowCode='M',        # Import
                            partner2Code=None, customsCode=None, motCode=None,
                            maxRecords=100, format_output='JSON', includeDesc=True
                        )
                    else:
                        # 免费预览（500条限制）
                        df = comtradeapicall.previewFinalData(
                            typeCode='C', freqCode='A', clCode='HS', period='2021',
                            reporterCode='643', partnerCode='156', cmdCode=hs_code,
                            flowCode='M', partner2Code=None, customsCode=None, motCode=None,
                            maxRecords=100, format_output='JSON', includeDesc=True
                        )
                    
                    if df is not None and hasattr(df, 'empty') and not df.empty:
                        value = df['primaryValue'].sum()
                        if value > 0:
                            total_china_import += value
                            found_hs_codes.append({
                                "hs_code": hs_code,
                                "hs_desc": hs_desc,
                                "value_usd": value,
                                "year": "2021",
                                "source": "UN Comtrade"
                            })
                            print(f"  ✅ HS {hs_code} ({hs_desc}): ${value:,.0f}")
                            
                except Exception as e:
                    continue
            
            if found_hs_codes:
                evidence["found"] = True
                evidence["score"] = 40  # 强证据：海关数据
                evidence["details"] = found_hs_codes
                evidence["total_china_import"] = total_china_import
                print(f"  💰 总计从中国进口: ${total_china_import:,.0f}")
            else:
                print(f"  ⚠️ 未找到中国进口记录")
                evidence["details"] = [{"note": "俄罗斯2021年无该HS Code进口记录"}]
                
        except ImportError:
            print(f"  ⚠️ comtradeapicall未安装")
            print(f"     安装: pip3 install comtradeapicall")
            evidence["details"] = [{"note": "未安装comtradeapicall"}]
        except Exception as e:
            print(f"  ⚠️ 查询失败: {str(e)[:100]}")
            evidence["details"] = [{"error": str(e)[:200]}]
        
        return evidence
    
    def check_elcp_contract(self, inn: str) -> Dict:
        """
        检查elcp.ru公开合同：供应商是否中国公司
        
        搜索合同页面，提取供应商名称，判断是否中国公司
        """
        print(f"\n📄 [2/3] 检查elcp.ru公开合同...")
        
        evidence = {"score": 0, "found": False, "details": []}
        
        # elcp.ru合同搜索URL
        if inn:
            search_url = f"http://www.elcp.ru/catalog/anketa/contracts?query={inn}"
        else:
            print(f"  ⚠️ 无INN，无法搜索elcp.ru合同")
            return evidence
        
        html = self.fetch_with_lightpanda(search_url)
        if not html:
            print(f"  ⚠️ 无法抓取elcp.ru页面")
            return evidence
        
        # 搜索中国关键词
        china_keywords_lower = [k.lower() for k in CHINA_CITY_KEYWORDS]
        china_keywords_lower.extend([
            "shenzhen", "深圳", "shanghai", "上海", "guangzhou", 
            "china", "中国", "китай", "chinese", "llc", " ltd"
        ])
        
        found_china_refs = []
        for keyword in china_keywords_lower:
            if keyword in html.lower():
                # 找到中国关键词，尝试提取上下文
                pattern = r'.{0,100}' + keyword + r'.{0,100}'
                matches = re.findall(pattern, html, re.IGNORECASE)
                for match in matches[:3]:  # 最多3个匹配
                    found_china_refs.append({
                        "keyword": keyword,
                        "context": match.strip()
                    })
        
        if found_china_refs:
            evidence["found"] = True
            evidence["score"] = 40  # 强证据：合同显示中国供应商
            evidence["details"] = found_china_refs
            print(f"  ✅ 找到中国供应商证据: {len(found_china_refs)}处")
        else:
            print(f"  ⚠️ 未找到中国供应商证据")
            evidence["score"] = 0
        
        return evidence
    
    def check_website_demand(self, website: str) -> Dict:
        """
        检查官网配件页：电子元器件需求分析
        
        抓取产品/配件页面，搜索：
        1. 型号前缀（STM32F, XC7, TPS...） - 最高优先级
        2. 全球品牌关键词（TI, ST, NXP...） - 中优先级
        3. 设备类型关键词（激光切割, CNC...） - 推测需求
        """
        print(f"\n🌐 [3/3] 检查官网元器件需求...")
        
        evidence = {"score": 0, "found": False, "details": [], "brands": [], "models": [], "categories": []}
        
        if not website:
            print(f"  ⚠️ 无官网地址，跳过检查")
            return evidence
        
        # 确保URL完整
        if not website.startswith("http"):
            website = f"https://{website}"
        
        # 尝试多个常见页面路径
        page_paths = [
            "/products", "/catalog", "/accessories", "/parts",
            "/components", "/equipment", "/tech", "/spare",
            "/specifications", "/docs", "/manual"
        ]
        
        found_models = []  # 型号匹配（最高优先级）
        found_brands = []  # 品牌匹配（中优先级）
        found_categories = []  # 设备类型（推测需求）
        
        # ========== 1. 型号前缀匹配（最高优先级） ==========
        def search_models(html, page_url):
            """搜索型号前缀（优先匹配最长前缀，避免重复）"""
            # 按前缀长度排序（长的优先，避免XC和XC7重复匹配）
            sorted_prefixes = sorted(MODEL_PREFIXES.items(), 
                                     key=lambda x: len(x[0]), reverse=True)
            
            matched_models = set()  # 防止重复
            
            for model_prefix, model_info in sorted_prefixes:
                # 简化的正则：前缀 + 数字字母后缀
                # 注意：不用\b边界，直接匹配前缀开头
                pattern = model_prefix + r'[A-Za-z0-9\-_]*'
                matches = re.findall(pattern, html, re.IGNORECASE)
                
                if matches:
                    for match in matches[:3]:
                        # 去重
                        match_key = match.upper()
                        if match_key in matched_models:
                            continue
                        matched_models.add(match_key)
                        
                        found_models.append({
                            "type": "model",
                            "prefix": model_prefix,
                            "match": match,
                            "brand": model_info.get("brand", "Unknown"),
                            "category": model_info.get("category", ""),
                            "demand": model_info.get("demand", ""),
                            "score": model_info.get("score", 25),
                            "page": page_url
                        })
        
        # ========== 2. 品牌关键词匹配 ==========
        def search_brands(html, page_url):
            """搜索品牌关键词"""
            for brand_id, brand_info in GLOBAL_BRANDS.items():
                for keyword in brand_info.get("keywords", []):
                    if keyword.lower() in html.lower():
                        # 提取上下文
                        pattern = r'.{0,40}' + keyword + r'.{0,40}'
                        context_matches = re.findall(pattern, html, re.IGNORECASE)
                        for ctx in context_matches[:2]:
                            found_brands.append({
                                "type": "brand",
                                "brand_id": brand_id,
                                "brand_name": brand_info.get("name", brand_id),
                                "keyword": keyword,
                                "products": brand_info.get("products", []),
                                "value": brand_info.get("value", "中"),
                                "score": 25 if brand_info.get("value") == "极高" else 
                                         20 if brand_info.get("value") == "高" else 15,
                                "page": page_url,
                                "context": ctx.strip()
                            })
                        break
        
        # ========== 3. 设备类型关键词匹配（推测需求） ==========
        def search_categories(html, page_url):
            """搜索设备类型关键词"""
            html_lower = html.lower()
            for cat_id, cat_info in CATEGORY_KEYWORDS.items():
                # 英语关键词
                for kw in cat_info.get("keywords_en", []):
                    if kw.lower() in html_lower:
                        found_categories.append({
                            "type": "category",
                            "category": cat_id,
                            "keyword": kw,
                            "needs": cat_info.get("needs", []),
                            "related_brands": cat_info.get("brands", []),
                            "score": cat_info.get("score_boost", 15),
                            "page": page_url
                        })
                        break
                
                # 俄语关键词
                for kw in cat_info.get("keywords_ru", []):
                    if kw.lower() in html_lower:
                        found_categories.append({
                            "type": "category",
                            "category": cat_id,
                            "keyword": kw,
                            "language": "ru",
                            "needs": cat_info.get("needs", []),
                            "related_brands": cat_info.get("brands", []),
                            "score": cat_info.get("score_boost", 15),
                            "page": page_url
                        })
                        break
        
        # ========== 扫描所有页面 ==========
        for path in page_paths:
            test_url = f"{website.rstrip('/')}{path}"
            print(f"  🔍 检查: {test_url}")
            
            html = self.fetch_with_lightpanda(test_url, timeout=20)
            if not html:
                continue
            
            search_models(html, test_url)
            search_brands(html, test_url)
            search_categories(html, test_url)
        
        # 检查首页
        print(f"  🔍 检查首页: {website}")
        html = self.fetch_with_lightpanda(website, timeout=20)
        if html:
            search_models(html, website)
            search_brands(html, website)
            search_categories(html, website)
        
        # ========== 计算得分（取最高） ==========
        all_findings = found_models + found_brands + found_categories
        
        if all_findings:
            evidence["found"] = True
            evidence["details"] = all_findings
            evidence["models"] = found_models
            evidence["brands"] = found_brands
            evidence["categories"] = found_categories
            
            # 计算最高得分
            max_score = max([f.get("score", 0) for f in all_findings])
            evidence["score"] = max_score
            
            # 输出汇总
            if found_models:
                model_summary = {}
                for m in found_models:
                    brand = m.get("brand", "Unknown")
                    if brand not in model_summary:
                        model_summary[brand] = []
                    model_summary[brand].append(m.get("match", ""))
                print(f"  ✅ 发现型号:")
                for brand, models in model_summary.items():
                    print(f"     {brand}: {', '.join(models[:5])}")
            
            if found_brands:
                brand_names = set([b.get("brand_name", "") for b in found_brands])
                print(f"  ✅ 发现品牌: {', '.join(brand_names)}")
            
            if found_categories:
                cat_names = set([c.get("category", "") for c in found_categories])
                print(f"  ✅ 设备类型: {', '.join(cat_names)}")
            
            print(f"  💰 需求得分: {max_score}分")
        else:
            print(f"  ⚠️ 未发现元器件需求信号")
            evidence["score"] = 0
        
        return evidence
    
    def calculate_total_score(self) -> int:
        """计算总分：中国采购证据维度（满分40分）"""
        scores = [
            self.results["evidence"]["comtrade"]["score"],
            self.results["evidence"]["elcp"]["score"],
            self.results["evidence"]["website"]["score"],
        ]
        
        # 取最高分（不叠加，因为可能是同一采购的不同证据）
        max_score = max(scores)
        
        # 如果没有任何证据，检查是否有元器件需求迹象
        if max_score == 0 and self.results["evidence"]["website"]["details"]:
            # 有产品信息但没有中国品牌 = 弱需求
            max_score = 10
        
        self.results["total_score"] = max_score
        return max_score
    
    def generate_recommendation(self) -> str:
        """生成行动建议"""
        score = self.results["total_score"]
        
        if score >= 40:
            return "🔴 强证据：必须开发 - 有明确中国采购记录"
        elif score >= 30:
            return "🟠 中证据：优先开发 - 官网配件页有中国品牌"
        elif score >= 20:
            return "🟡 弱证据：正常开发 - 有中国关联迹象"
        elif score >= 10:
            return "🟢 需求迹象：收集更多信息"
        else:
            return "⚪ 无证据：暂不主动联系"
    
    def check_single_company(self, inn: Optional[str] = None, 
                             company_name: Optional[str] = None,
                             website: Optional[str] = None) -> Dict:
        """检查单个公司的中国采购证据"""
        
        self.results["company"] = company_name
        self.results["inn"] = inn
        self.results["website"] = website
        
        print(f"\n{'='*60}")
        print(f"🇨🇳 中国采购证据检查")
        print(f"{'='*60}")
        print(f"公司: {company_name or '未知'}")
        print(f"INN: {inn or '未知'}")
        print(f"官网: {website or '未知'}")
        
        # 1. 检查UN Comtrade海关数据
        if inn:
            self.results["evidence"]["comtrade"] = self.check_comtrade(inn, company_name)
        else:
            print(f"\n📊 [1/3] ⚠️ 无INN，跳过海关数据检查")
        
        # 2. 检查elcp.ru合同
        if inn:
            self.results["evidence"]["elcp"] = self.check_elcp_contract(inn)
        
        # 3. 检查官网配件页
        if website:
            self.results["evidence"]["website"] = self.check_website_demand(website)
        
        # 计算总分
        total = self.calculate_total_score()
        
        # 生成建议
        self.results["recommendation"] = self.generate_recommendation()
        
        print(f"\n{'='*60}")
        print(f"📊 结果汇总")
        print(f"{'='*60}")
        print(f"海关数据: {self.results['evidence']['comtrade']['score']}分")
        print(f"elcp合同: {self.results['evidence']['elcp']['score']}分")
        print(f"官网品牌: {self.results['evidence']['website']['score']}分")
        print(f"总分: {total}分")
        print(f"建议: {self.results['recommendation']}")
        
        return self.results
    
    def check_batch(self, csv_path: str) -> List[Dict]:
        """批量检查公司列表"""
        results = []
        
        print(f"\n📂 批量检查: {csv_path}")
        
        try:
            with open(csv_path, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                
                for row in reader:
                    inn = row.get('inn') or row.get('INN')
                    name = row.get('name') or row.get('公司名') or row.get('公司名称')
                    website = row.get('website') or row.get('官网') or row.get('URL')
                    
                    if not (inn or name):
                        continue
                    
                    # 检查单个公司
                    result = self.check_single_company(inn, name, website)
                    results.append(result)
                    
                    # 保存结果
                    self.save_results(result)
        
        except Exception as e:
            print(f"⚠️ 批量检查失败: {e}")
        
        return results
    
    def save_results(self, result: Dict, format: str = "both"):
        """保存检查结果"""
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        
        company_name = result["company"] or result["inn"] or "unknown"
        safe_name = re.sub(r'[^\w\-]', '_', company_name)[:50]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # JSON格式
        if format in ["json", "both"]:
            json_path = OUTPUT_DIR / f"{safe_name}_{timestamp}.json"
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            print(f"  💾 保存JSON: {json_path}")
        
        # Markdown格式
        if format in ["md", "both"]:
            md_path = OUTPUT_DIR / f"{safe_name}_{timestamp}.md"
            md_content = self.format_as_markdown(result)
            with open(md_path, 'w', encoding='utf-8') as f:
                f.write(md_content)
            print(f"  💾 保存Markdown: {md_path}")
    
    def format_as_markdown(self, result: Dict) -> str:
        """格式化为Markdown报告"""
        md = f"""# 中国采购证据检查报告

**公司**: {result['company'] or '未知'}
**INN**: {result['inn'] or '未知'}
**官网**: {result['website'] or '未知'}
**检查时间**: {result['check_time']}
**总分**: {result['total_score']}分
**建议**: {result['recommendation']}

---

## 证据详情

### 1. 海关数据 (UN Comtrade)
- **分数**: {result['evidence']['comtrade']['score']}分
- **发现**: {result['evidence']['comtrade']['found']}
- **详情**:
"""
        
        for detail in result['evidence']['comtrade']['details']:
            md += f"  - {detail}\n"
        
        md += f"""
### 2. elcp.ru合同
- **分数**: {result['evidence']['elcp']['score']}分
- **发现**: {result['evidence']['elcp']['found']}
- **详情**:
"""
        
        for detail in result['evidence']['elcp']['details']:
            md += f"  - 关键词: {detail['keyword']}\n"
            md += f"    上下文: {detail['context'][:100]}\n"
        
        md += f"""
### 3. 官网配件页
- **分数**: {result['evidence']['website']['score']}分
- **发现**: {result['evidence']['website']['found']}
- **详情**:
"""
        
        for detail in result['evidence']['website']['details']:
            md += f"  - 品牌: {detail['brand']}\n"
            md += f"    页面: {detail['page']}\n"
            md += f"    关键词: {detail['keyword']}\n"
        
        md += """
---

## 评分规则 (v2.0)

| 证据强度 | 分数 | 说明 |
|---------|------|------|
| 强证据 | 40分 | 海关数据/elcp.ru合同显示"从中国公司采购电子元器件" |
| 中证据 | 30分 | 官网配件页显示中国品牌（如AiPuLong激光管、S&A冷水机） |
| 弱证据 | 20分 | 社交媒体晒中国产品，或产品描述暗示中国来源 |
| 无证据但有需求 | 10分 | 产品类型明确需要电子元器件（CNC、机器人、PLC设备） |
| 无证据无需求 | 0分 | 业务不相关或无法判断 |

---

**生成脚本**: `check_china_purchase.py`
"""
        
        return md


def main():
    parser = argparse.ArgumentParser(description="中国采购证据检查脚本")
    parser.add_argument("--inn", help="公司INN")
    parser.add_argument("--name", "--company", help="公司名称")
    parser.add_argument("--website", help="公司官网")
    parser.add_argument("--batch", help="批量检查CSV文件")
    parser.add_argument("--api-key", help="UN Comtrade API Key")
    parser.add_argument("--output", choices=["json", "md", "both"], default="both", help="输出格式")
    
    args = parser.parse_args()
    
    checker = ChinaPurchaseChecker(comtrade_api_key=args.api_key)
    
    if args.batch:
        # 批量检查
        results = checker.check_batch(args.batch)
        print(f"\n✅ 批量检查完成: {len(results)}家公司")
        
        # 输出汇总CSV
        csv_path = OUTPUT_DIR / f"batch_summary_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        with open(csv_path, 'w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['公司', 'INN', '官网', '海关数据分数', 'elcp分数', '官网分数', '总分', '建议'])
            for r in results:
                writer.writerow([
                    r['company'],
                    r['inn'],
                    r['website'],
                    r['evidence']['comtrade']['score'],
                    r['evidence']['elcp']['score'],
                    r['evidence']['website']['score'],
                    r['total_score'],
                    r['recommendation']
                ])
        print(f"  💾 汇总CSV: {csv_path}")
        
    elif args.inn or args.name or args.website:
        # 单个公司检查
        result = checker.check_single_company(args.inn, args.name, args.website)
        checker.save_results(result, args.output)
        
    else:
        parser.print_help()
        print("\n示例:")
        print("  python3 check_china_purchase.py --inn 7704736686 --name 'Ростех'")
        print("  python3 check_china_purchase.py --company 'ЧПУ24' --website 'chpu24.com'")
        print("  python3 check_china_purchase.py --batch customers.csv")


if __name__ == "__main__":
    main()