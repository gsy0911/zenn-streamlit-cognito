import boto3
from botocore.config import Config

API_CALL_NUM_RETRIES = 5
client = boto3.client("wafv2", config=Config(retries={"max_attempts": API_CALL_NUM_RETRIES}))


class WafV2IpSet:
    def __init__(self, ip_sets_name: str, ip_sets_arn: str):
        self.ip_sets_name = ip_sets_name
        self.ip_sets_arn = ip_sets_arn
        self.ip_sets_id = self.arn_to_id(ip_sets_arn)

    @staticmethod
    def arn_to_id(arn: str):
        if arn is None:
            return None
        tmp = arn.split("/")
        return tmp.pop()

    def get_ip_set(self):
        try:
            response = client.get_ip_set(Scope="REGIONAL", Name=self.ip_sets_name, Id=self.ip_sets_id)
            return response
        except Exception as e:
            print("Failed to get IPSet %s", str(self.ip_sets_id))
            print(str(e))
            return None

    def get_addresses(self):
        response = self.get_ip_set()
        addresses = response["IPSet"]["Addresses"]
        return addresses

    def update_ip_set(self, addresses: list):
        print("[waflib:update_ip_set] Start")
        try:
            # retrieve the ipset to get a LockToken
            ip_set = self.get_ip_set()
            lock_token = ip_set["LockToken"]
            description = ip_set["IPSet"]["Description"]
            print("Updating IPSet with description: %s", str(description))

            response = client.update_ip_set(
                Scope="REGIONAL",
                Name=self.ip_sets_name,
                Description=description,
                Id=self.ip_sets_id,
                Addresses=addresses,
                LockToken=lock_token,
            )
            print(response)

            new_ip_set = self.get_ip_set()
            print("[waflib:update_ip_set] End")
            return new_ip_set
        except Exception as e:
            print(e)
            print("Failed to update IPSet: %s", str(self.ip_sets_id))
            return None
