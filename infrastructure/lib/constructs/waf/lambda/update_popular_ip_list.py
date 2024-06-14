import os
import re

import requests
from wafv2_ip_set import WafV2IpSet

IP_SETS_ARN = os.environ["IP_SETS_ARN"]
IP_SETS_NAME = os.environ["IP_SETS_NAME"]


class PopularIpSet:
    popular_ip_url_list = [
        {"url": "https://www.spamhaus.org/drop/drop.txt"},
        {"url": "https://www.spamhaus.org/drop/edrop.txt"},
        {"url": "https://check.torproject.org/exit-addresses", "prefix": "ExitAddress"},
        {"url": "https://rules.emergingthreats.net/fwrules/emerging-Block-IPs.txt"},
    ]

    @staticmethod
    def find_ips(line, prefix=""):
        reg = re.compile(
            "^"
            + prefix
            + "\\s*((?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])\\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])(?:/(?:3[0-2]|[1-2][0-9]|[0-9]))?)"
        )
        ips = re.findall(reg, line)
        # WafV2のIPに登録する際にCIDR表記が必須のため
        new_ips = [ip for ip in ips if len(ip.split("/")) == 2]
        new_ips.extend([f"{ip}/32" for ip in ips if len(ip.split("/")) == 1])
        return new_ips

    def _obtain_ip_set(self, url: str, prefix: str):
        response = requests.get(url)
        ip_set = set()
        for line in response.iter_lines():
            ip_set.update(self.find_ips(line=line.decode("utf-8").strip(), prefix=prefix))
        return ip_set

    def obtain_all_ip_set(self) -> set:
        all_ip_set = set()
        for ips in self.popular_ip_url_list:
            tmp_ip_set = self._obtain_ip_set(ips["url"], ips.get("prefix", ""))
            all_ip_set.update(tmp_ip_set)
        return all_ip_set


def handler(event, _):
    wafv2_ip_set = WafV2IpSet(ip_sets_name=IP_SETS_NAME, ip_sets_arn=IP_SETS_ARN)
    current_addresses = wafv2_ip_set.get_addresses()

    popular_ip_set = PopularIpSet().obtain_all_ip_set()

    update_ip_set = set()
    update_ip_set.update(current_addresses)
    update_ip_set.update(popular_ip_set)
    wafv2_ip_set.update_ip_set(list(update_ip_set))
    # 新規追加されたIPを表示
    print(f"newly added: {popular_ip_set - current_addresses}")
    return {"status": "success", "updated_count": len(update_ip_set)}
