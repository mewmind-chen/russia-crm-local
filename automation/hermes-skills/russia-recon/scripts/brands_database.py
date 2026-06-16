#!/usr/bin/env python3
"""
全球电子元器件品牌识别库
用于分析俄罗斯客户官网配件页/产品页使用的元器件品牌

核心逻辑：
- 华强北可以供应全球几乎所有品牌
- 所以品牌识别 = 需求识别
- 找到客户使用的任何品牌 = 找到销售机会
"""

# ========== 全球主流品牌（华强北渠道可供应） ==========

GLOBAL_BRANDS = {
    # ───────────────────────────────────────────────────
    # 欧美品牌（主流，高价值）
    # ───────────────────────────────────────────────────
    "TI": {
        "name": "Texas Instruments",
        "keywords": ["ti", "texas instruments", "ti芯片", "ti器件"],
        "products": ["电源管理IC", "运算放大器", "逻辑IC", "MCU"],
        "value": "高",
        "type": "欧美",
    },
    "ADI": {
        "name": "Analog Devices",
        "keywords": ["adi", "analog devices", "adi芯片", "ad器件", "模拟器件"],
        "products": ["ADC/DAC", "运算放大器", "射频IC"],
        "value": "高",
        "type": "欧美",
    },
    "ST": {
        "name": "STMicroelectronics",
        "keywords": ["st", "stmicroelectronics", "意法半导体", "stm", "stm32", "stm8"],
        "products": ["STM32 MCU", "功率器件", "传感器"],
        "value": "极高",
        "type": "欧美",
    },
    "Infineon": {
        "name": "Infineon",
        "keywords": ["infineon", "英飞凌", "infineon芯片"],
        "products": ["IGBT", "MOSFET", "MCU", "传感器"],
        "value": "高",
        "type": "欧美",
    },
    "NXP": {
        "name": "NXP Semiconductors",
        "keywords": ["nxp", "恩智浦", "nxp芯片", "lpc"],
        "products": ["MCU", "RF IC", "汽车电子"],
        "value": "高",
        "type": "欧美",
    },
    "Microchip": {
        "name": "Microchip Technology",
        "keywords": ["microchip", "微芯", "pic", "avr", "atmel"],
        "products": ["PIC MCU", "AVR", "存储器"],
        "value": "中高",
        "type": "欧美",
    },
    "ONsemi": {
        "name": "ON Semiconductor",
        "keywords": ["onsemi", "安森美", "on semiconductor", "fairchild"],
        "products": ["MOSFET", "IGBT", "二极管", "传感器"],
        "value": "中高",
        "type": "欧美",
    },
    "Maxim": {
        "name": "Maxim Integrated",
        "keywords": ["maxim", "美信", "maxim芯片", "maxim器件"],
        "products": ["电源管理", "实时时钟", "接口IC"],
        "value": "中高",
        "type": "欧美",
    },
    "Renesas": {
        "name": "Renesas",
        "keywords": ["renesas", "瑞萨", "renesas芯片"],
        "products": ["MCU", "功率器件", "汽车电子"],
        "value": "中高",
        "type": "日韩",
    },
    "Vishay": {
        "name": "Vishay",
        "keywords": ["vishay", "威世"],
        "products": ["电阻", "电容", "二极管", "MOSFET"],
        "value": "中",
        "type": "欧美",
    },
    "Intel": {
        "name": "Intel",
        "keywords": ["intel", "英特尔", "intel芯片", "cpu"],
        "products": ["CPU", "FPGA", "闪存"],
        "value": "高",
        "type": "欧美",
    },
    "Xilinx": {
        "name": "Xilinx/AMD FPGA",
        "keywords": ["xilinx", "赛灵思", "fpga", "zynq", "artix", "kintex", "virtex"],
        "products": ["FPGA", "SoC"],
        "value": "极高",
        "type": "欧美",
    },
    "Altera": {
        "name": "Altera/Intel FPGA",
        "keywords": ["altera", "英特尔fpga", "cyclone", "stratix"],
        "products": ["FPGA"],
        "value": "高",
        "type": "欧美",
    },
    
    # ───────────────────────────────────────────────────
    # 日韩品牌
    # ───────────────────────────────────────────────────
    "Samsung": {
        "name": "Samsung",
        "keywords": ["samsung", "三星", "三星电子"],
        "products": ["存储器", "MCU", "显示驱动"],
        "value": "中高",
        "type": "日韩",
    },
    "Rohm": {
        "name": "ROHM",
        "keywords": ["rohm", "罗姆"],
        "products": ["功率器件", "LED驱动", "传感器"],
        "value": "中",
        "type": "日韩",
    },
    "Toshiba": {
        "name": "Toshiba/Kioxia",
        "keywords": ["toshiba", "东芝", "kioxia"],
        "products": ["存储器", "功率器件"],
        "value": "中",
        "type": "日韩",
    },
    "Panasonic": {
        "name": "Panasonic",
        "keywords": ["panasonic", "松下"],
        "products": ["继电器", "电容", "传感器"],
        "value": "中",
        "type": "日韩",
    },
    "Murata": {
        "name": "Murata",
        "keywords": ["murata", "村田"],
        "products": ["电容", "电感", "滤波器"],
        "value": "中高",
        "type": "日韩",
    },
    "TDK": {
        "name": "TDK",
        "keywords": ["tdk", "电感", "tdk电容"],
        "products": ["电容", "电感", "传感器"],
        "value": "中",
        "type": "日韩",
    },
    
    # ───────────────────────────────────────────────────
    # 台湾品牌（华强北热门）
    # ───────────────────────────────────────────────────
    "Delta": {
        "name": "Delta Electronics",
        "keywords": ["delta", "台达", "台达电子", "delta电源"],
        "products": ["电源", "变频器", "散热风扇"],
        "value": "高",
        "type": "台湾",
    },
    "MeanWell": {
        "name": "Mean Well",
        "keywords": ["meanwell", "明纬", "mean well电源", "mw电源"],
        "products": ["开关电源"],
        "value": "高",
        "type": "台湾",
    },
    "LiteOn": {
        "name": "Lite-On",
        "keywords": ["liteon", "光宝"],
        "products": ["LED", "电源", "光电"],
        "value": "中",
        "type": "台湾",
    },
    "Winbond": {
        "name": "Winbond",
        "keywords": ["winbond", "华邦", "w25"],
        "products": ["Flash存储器"],
        "value": "高",
        "type": "台湾",
    },
    
    # ───────────────────────────────────────────────────
    # 中国品牌（替代进口，性价比高）
    # ───────────────────────────────────────────────────
    "INVT": {
        "name": "INVT 汇川",
        "keywords": ["invt", "汇川", "汇川技术", "汇川变频器"],
        "products": ["变频器", "伺服", "PLC"],
        "value": "高",
        "type": "中国",
    },
    "Estun": {
        "name": "ESTUN 埃斯顿",
        "keywords": ["estun", "埃斯顿", "埃斯顿机器人"],
        "products": ["伺服", "机器人"],
        "value": "高",
        "type": "中国",
    },
    "Xinje": {
        "name": "Xinje 信捷",
        "keywords": ["xinje", "信捷", "信捷PLC", "信捷触摸屏"],
        "products": ["PLC", "触摸屏", "伺服"],
        "value": "中高",
        "type": "中国",
    },
    "Raycus": {
        "name": "Raycus",
        "keywords": ["raycus", "锐科", "锐科激光", "光纤激光器"],
        "products": ["光纤激光器"],
        "value": "高",
        "type": "中国",
    },
    "JPT": {
        "name": "JPT",
        "keywords": ["jpt", "创鑫激光", "创鑫"],
        "products": ["光纤激光器"],
        "value": "高",
        "type": "中国",
    },
    "Reci": {
        "name": "Reci",
        "keywords": ["reci", "rek", "激光管", "co2激光管"],
        "products": ["CO2激光管"],
        "value": "中高",
        "type": "中国",
    },
    "S&A": {
        "name": "S&A Tewin",
        "keywords": ["s&a", "s and a", "tewin", "冷水机", "chiller", "特域"],
        "products": ["激光冷水机"],
        "value": "中高",
        "type": "中国",
    },
    "Leadshine": {
        "name": "Leadshine 雷赛",
        "keywords": ["leadshine", "雷赛", "步进驱动", "步进电机"],
        "products": ["步进驱动", "步进电机", "伺服"],
        "value": "中高",
        "type": "中国",
    },
    "GigaDevice": {
        "name": "GigaDevice 兆易创新",
        "keywords": ["gigadevice", "兆易创新", "gd32", "gd_flash"],
        "products": ["GD32 MCU", "Flash"],
        "value": "极高",
        "type": "中国",
    },
    "WCH": {
        "name": "WCH 沁恒",
        "keywords": ["wch", "沁恒", "ch32", "ch340"],
        "products": ["CH32 MCU", "USB芯片"],
        "value": "高",
        "type": "中国",
    },
    "Espressif": {
        "name": "Espressif 乐鑫",
        "keywords": ["espressif", "乐鑫", "esp32", "esp8266"],
        "products": ["WiFi MCU"],
        "value": "极高",
        "type": "中国",
    },
    
    # ───────────────────────────────────────────────────
    # 分立器件/被动元件品牌
    # ───────────────────────────────────────────────────
    "TE": {
        "name": "TE Connectivity",
        "keywords": ["te", "te connectivity", "泰科", "amp", "连接器"],
        "products": ["连接器", "继电器"],
        "value": "中高",
        "type": "欧美",
    },
    "Molex": {
        "name": "Molex",
        "keywords": ["molex", "莫莱克斯", "连接器"],
        "products": ["连接器"],
        "value": "中高",
        "type": "欧美",
    },
    "Amphenol": {
        "name": "Amphenol",
        "keywords": ["amphenol", "安费诺"],
        "products": ["连接器"],
        "value": "中高",
        "type": "欧美",
    },
    "AVX": {
        "name": "AVX",
        "keywords": ["avx", "avx电容", "钽电容"],
        "products": ["电容", "连接器"],
        "value": "中",
        "type": "欧美",
    },
    "KEMET": {
        "name": "KEMET",
        "keywords": ["kemet", "基美"],
        "products": ["电容"],
        "value": "中",
        "type": "欧美",
    },
    
    # ───────────────────────────────────────────────────
    # 传感器品牌
    # ───────────────────────────────────────────────────
    "Bosch": {
        "name": "Bosch Sensortec",
        "keywords": ["bosch", "博世", "bme", "bmp"],
        "products": ["IMU传感器", "气压传感器"],
        "value": "中高",
        "type": "欧美",
    },
    "Honeywell": {
        "name": "Honeywell",
        "keywords": ["honeywell", "霍尼韦尔"],
        "products": ["传感器", "压力传感器"],
        "value": "中高",
        "type": "欧美",
    },
}

# ========== 型号前缀识别（直接指向需求） ==========

MODEL_PREFIXES = {
    # MCU型号前缀 - 需求极高
    "STM32F": {"brand": "ST", "category": "MCU", "demand": "极高", "score": 30},
    "STM32H": {"brand": "ST", "category": "高性能MCU", "demand": "极高", "score": 30},
    "STM32L": {"brand": "ST", "category": "低功耗MCU", "demand": "高", "score": 25},
    "STM8": {"brand": "ST", "category": "8位MCU", "demand": "中", "score": 20},
    "PIC": {"brand": "Microchip", "category": "MCU", "demand": "中高", "score": 25},
    "ATmega": {"brand": "Microchip", "category": "AVR MCU", "demand": "高", "score": 25},
    "ATtiny": {"brand": "Microchip", "category": "小封装MCU", "demand": "中", "score": 20},
    "LPC": {"brand": "NXP", "category": "MCU", "demand": "中高", "score": 25},
    "IMXRT": {"brand": "NXP", "category": "高性能MCU", "demand": "高", "score": 25},
    "XMC": {"brand": "Infineon", "category": "MCU", "demand": "中", "score": 20},
    "RA": {"brand": "Renesas", "category": "MCU", "demand": "中", "score": 20},
    "RX": {"brand": "Renesas", "category": "MCU", "demand": "中", "score": 20},
    "ESP32": {"brand": "Espressif", "category": "WiFi MCU", "demand": "极高", "score": 30},
    "ESP8266": {"brand": "Espressif", "category": "WiFi MCU", "demand": "高", "score": 25},
    "GD32": {"brand": "GigaDevice", "category": "MCU(ST替代)", "demand": "极高", "score": 30},
    "CH32": {"brand": "WCH", "category": "MCU", "demand": "高", "score": 25},
    
    # FPGA型号前缀 - 需求极高
    "XC7": {"brand": "Xilinx", "category": "FPGA", "demand": "极高", "score": 30},
    "XC": {"brand": "Xilinx", "category": "FPGA", "demand": "高", "score": 25},
    "Zynq": {"brand": "Xilinx", "category": "SoC FPGA", "demand": "极高", "score": 30},
    "Artix": {"brand": "Xilinx", "category": "FPGA", "demand": "高", "score": 25},
    "Kintex": {"brand": "Xilinx", "category": "FPGA", "demand": "高", "score": 25},
    "Virtex": {"brand": "Xilinx", "category": "高端FPGA", "demand": "极高", "score": 30},
    "Cyclone": {"brand": "Intel/Altera", "category": "FPGA", "demand": "高", "score": 25},
    "Stratix": {"brand": "Intel/Altera", "category": "高端FPGA", "demand": "极高", "score": 30},
    
    # 电源IC型号前缀 - 需求高
    "LM": {"brand": "TI", "category": "电源/运放", "demand": "高", "score": 25},
    "TPS": {"brand": "TI", "category": "电源管理", "demand": "极高", "score": 30},
    "LT": {"brand": "ADI/Linear", "category": "电源管理", "demand": "高", "score": 25},
    "ADP": {"brand": "ADI", "category": "电源管理", "demand": "中高", "score": 20},
    "MAX": {"brand": "Maxim", "category": "电源/接口", "demand": "高", "score": 25},
    "DS": {"brand": "Maxim", "category": "接口IC", "demand": "中", "score": 15},
    "LDO": {"brand": "多家", "category": "稳压器", "demand": "高", "score": 25},
    
    # 运放型号前缀 - 需求高
    "OP": {"brand": "TI/ADI", "category": "运算放大器", "demand": "高", "score": 25},
    "NE": {"brand": "TI", "category": "运放", "demand": "中", "score": 20},
    "LM358": {"brand": "TI", "category": "双运放", "demand": "极高", "score": 30},
    "LM7805": {"brand": "TI/多家", "category": "稳压器", "demand": "极高", "score": 30},
    "AMS1117": {"brand": "多家", "category": "LDO", "demand": "极高", "score": 30},
    
    # 功率器件型号前缀 - 需求极高
    "IRF": {"brand": "Infineon/IR", "category": "MOSFET", "demand": "极高", "score": 30},
    "FDP": {"brand": "ONsemi", "category": "MOSFET", "demand": "高", "score": 25},
    "STP": {"brand": "ST", "category": "MOSFET", "demand": "高", "score": 25},
    "2SK": {"brand": "Rohm/Toshiba", "category": "MOSFET", "demand": "中", "score": 20},
    "IGBT": {"brand": "多家", "category": "IGBT", "demand": "极高", "score": 30},
    "STW": {"brand": "ST", "category": "IGBT", "demand": "高", "score": 25},
    
    # 存储器型号前缀 - 需求高
    "AT24": {"brand": "多家", "category": "EEPROM", "demand": "高", "score": 25},
    "W25": {"brand": "Winbond", "category": "Flash", "demand": "极高", "score": 30},
    "MX25": {"brand": "Macronix", "category": "Flash", "demand": "高", "score": 25},
    "IS25": {"brand": "ISSI", "category": "Flash", "demand": "高", "score": 25},
    "MT": {"brand": "Micron", "category": "存储器", "demand": "高", "score": 25},
    "K9": {"brand": "Samsung", "category": "Flash", "demand": "高", "score": 25},
    "HY": {"brand": "ISSI/多家", "category": "DRAM", "demand": "高", "score": 25},
    "SST": {"brand": "SST", "category": "Flash", "demand": "中高", "score": 20},
    
    # 通信/接口芯片 - 需求高
    "CH340": {"brand": "WCH", "category": "USB转串口", "demand": "极高", "score": 30},
    "CP210": {"brand": "Silicon Labs", "category": "USB转串口", "demand": "高", "score": 25},
    "MAX232": {"brand": "Maxim", "category": "RS232", "demand": "高", "score": 25},
    "RS485": {"brand": "多家", "category": "通信IC", "demand": "高", "score": 25},
    "CAN": {"brand": "多家", "category": "CAN总线", "demand": "高", "score": 25},
    
    # 传感器型号 - 需求高
    "BME280": {"brand": "Bosch", "category": "环境传感器", "demand": "高", "score": 25},
    "BMP280": {"brand": "Bosch", "category": "气压传感器", "demand": "高", "score": 25},
    "MPU6050": {"brand": "InvenSense", "category": "IMU", "demand": "高", "score": 25},
    "MPU9250": {"brand": "InvenSense", "category": "IMU", "demand": "高", "score": 25},
    "DS18B20": {"brand": "Maxim", "category": "温度传感器", "demand": "高", "score": 25},
    "DHT": {"brand": "多家", "category": "温湿度传感器", "demand": "高", "score": 25},
    
    # 激光配件型号 - 需求高
    "CO2-": {"brand": "Reci/EFR", "category": "激光管", "demand": "高", "score": 25},
    "Raycus-": {"brand": "Raycus", "category": "光纤激光器", "demand": "极高", "score": 30},
}

# ========== 产品类别关键词（间接需求信号） ==========

CATEGORY_KEYWORDS = {
    # 设备类型 → 推测需要的元器件
    "激光切割机": {
        "keywords_en": ["laser cutting", "laser cutter", "co2 laser", "fiber laser"],
        "keywords_ru": ["лазерная резка", "лазерный станок", "co2 лазер"],
        "needs": ["CO2激光管", "光纤激光器", "冷水机", "步进电机", "伺服", "激光电源", "反射镜", "聚焦镜", "MCU", "FPGA"],
        "brands": ["Reci", "Raycus", "JPT", "S&A", "Leadshine", "INVT", "ST", "Xilinx"],
        "score_boost": 30,
    },
    "激光焊接机": {
        "keywords_en": ["laser welding", "laser welder"],
        "keywords_ru": ["лазерная сварка", "лазерный сварка"],
        "needs": ["光纤激光器", "冷水机", "焊接头", "运动控制", "MCU"],
        "brands": ["Raycus", "JPT", "S&A", "ST"],
        "score_boost": 28,
    },
    "CNC数控机床": {
        "keywords_en": ["cnc", "cnc machine", "cnc router", "mill", "lathe"],
        "keywords_ru": ["чпу", "станок с чпу", "фрезерный", "токарный"],
        "needs": ["伺服电机", "伺服驱动", "PLC", "触摸屏", "主轴电机", "步进电机", "MCU"],
        "brands": ["INVT", "Estun", "Xinje", "Delta", "ST", "Xinje"],
        "score_boost": 28,
    },
    "3D打印机": {
        "keywords_en": ["3d printer", "printer", "reprap", "extruder"],
        "keywords_ru": ["3d принтер", "принтер"],
        "needs": ["步进电机", "步进驱动", "MCU", "温度传感器", "热端", "挤出机"],
        "brands": ["Leadshine", "STM32", "Marlin", "TI"],
        "score_boost": 20,
    },
    "工业机器人": {
        "keywords_en": ["robot", "industrial robot", "robotic arm"],
        "keywords_ru": ["робот", "промышленный робот", "манипулятор"],
        "needs": ["伺服电机", "伺服驱动", "减速器", "控制器", "传感器", "MCU", "FPGA"],
        "brands": ["Estun", "INVT", "Xilinx", "ST"],
        "score_boost": 30,
    },
    "自动化生产线": {
        "keywords_en": ["automation", "production line", "assembly"],
        "keywords_ru": ["автоматизация", "производственная линия", "линия"],
        "needs": ["PLC", "触摸屏", "传感器", "继电器", "变频器", "气动元件", "MCU"],
        "brands": ["Xinje", "INVT", "ST", "TI"],
        "score_boost": 25,
    },
    "电源/UPS": {
        "keywords_en": ["power supply", "ups", "inverter", "psu"],
        "keywords_ru": ["источник питания", "ups", "инвертор"],
        "needs": ["IGBT", "MOSFET", "DC-DC", "AC-DC", "电容", "变压器", "MCU"],
        "brands": ["Infineon", "TI", "ST", "MeanWell"],
        "score_boost": 22,
    },
    "通信设备": {
        "keywords_en": ["communication", "wireless", "router", "modem", "rf"],
        "keywords_ru": ["коммуникация", "беспроводной", "роутер", "модем"],
        "needs": ["RF模块", "WiFi模块", "MCU", "FPGA", "存储器", "网口"],
        "brands": ["ESP32", "NXP", "Xilinx", "Marvell"],
        "score_boost": 20,
    },
    "医疗设备": {
        "keywords_en": ["medical", "hospital", "diagnostic"],
        "keywords_ru": ["медицинский", "медицина", "диагностика"],
        "needs": ["传感器", "MCU", "显示屏", "电源", "连接器", "运放"],
        "brands": ["TI", "ADI", "ST", "Maxim"],
        "score_boost": 18,
    },
    "LED显示屏": {
        "keywords_en": ["led display", "led screen", "led panel"],
        "keywords_ru": ["led дисплей", "led экран", "светодиодный"],
        "needs": ["LED驱动IC", "MCU", "电源", "连接器", "FPGA"],
        "brands": ["MeanWell", "TI", "ST", "Xilinx"],
        "score_boost": 15,
    },
    "PCB制造": {
        "keywords_en": ["pcb", "printed circuit", "board manufacturing"],
        "keywords_ru": ["pcb", "печатная плата", "плата"],
        "needs": ["钻机", "曝光机", "测试仪", "MCU", "运动控制"],
        "brands": ["ST", "Xilinx", "Leadshine"],
        "score_boost": 25,
    },
}

# ========== 俄语关键词映射 ==========

RUSSIAN_KEYWORDS = {
    # 设备类型俄语
    "laser_cutting": "лазерная резка",
    "laser_welding": "лазерная сварка",
    "cnc": "чпу",
    "machine": "станок",
    "automation": "автоматизация",
    "robot": "робот",
    "power_supply": "источник питания",
    "motor": "двигатель",
    "servo": "серво",
    "plc": "плк",
    "sensor": "датчик",
    "display": "дисплей",
    "touchscreen": "сенсорный экран",
    "pcb": "печатная плата",
    "controller": "контроллер",
    "driver": "драйвер",
    "chiller": "охлаждающее устройство",
    "laser_tube": "лазерная трубка",
    "inverter": "инвертор",
    "变频器": "преобразователь частоты",
}

# ========== 中国城市关键词（采购来源信号） ==========

CHINA_CITY_KEYWORDS = [
    "shenzhen", "深圳",
    "shanghai", "上海",
    "guangzhou", "广州",
    "beijing", "北京",
    "dongguan", "东莞",
    "suzhou", "苏州",
    "huizhou", "惠州",
    "foshan", "佛山",
    "zhongshan", "中山",
    "ningbo", "宁波",
    "wuxi", "无锡",
    "nanjing", "南京",
    "chengdu", "成都",
    "wuhan", "武汉",
    "xi'an", "西安",
    "hangzhou", "杭州",
    "china", "中国", "китай",
    "chinese", "китайский",
]

# ========== 汇总统计 ==========

def get_stats():
    """返回品牌库统计信息"""
    return {
        "brands": len(GLOBAL_BRANDS),
        "model_prefixes": len(MODEL_PREFIXES),
        "categories": len(CATEGORY_KEYWORDS),
        "russian_keywords": len(RUSSIAN_KEYWORDS),
        "china_cities": len(CHINA_CITY_KEYWORDS),
    }

def list_all_keywords():
    """返回所有搜索关键词（用于网页扫描）"""
    keywords = []
    
    # 品牌关键词
    for brand_id, brand_info in GLOBAL_BRANDS.items():
        keywords.extend(brand_info.get("keywords", []))
    
    # 型号前缀
    keywords.extend(list(MODEL_PREFIXES.keys()))
    
    # 类别关键词
    for cat_id, cat_info in CATEGORY_KEYWORDS.items():
        keywords.extend(cat_info.get("keywords_en", []))
        keywords.extend(cat_info.get("keywords_ru", []))
    
    # 俄语关键词
    keywords.extend(list(RUSSIAN_KEYWORDS.values()))
    
    # 中国城市
    keywords.extend(CHINA_CITY_KEYWORDS)
    
    # 去重，转小写
    keywords = list(set([k.lower() for k in keywords if k]))
    
    return keywords

if __name__ == "__main__":
    stats = get_stats()
    print(f"✅ 全球品牌库加载完成")
    print(f"   - 品牌: {stats['brands']} 个")
    print(f"   - 型号前缀: {stats['model_prefixes']} 个")
    print(f"   - 产品类别: {stats['categories']} 个")
    print(f"   - 俄语关键词: {stats['russian_keywords']} 个")
    print(f"   - 中国城市: {stats['china_cities']} 个")
    print(f"   - 总搜索关键词: {len(list_all_keywords())} 个")