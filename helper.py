import json
import sys

class Helper:
    def hex_to_rgb(self, hex_code):
        # Remove the '#' if present
        hex_code = hex_code.lstrip('#')
        # Convert the hex string to an (R, G, B) tuple
        return tuple(int(hex_code[i:i+2], 16) for i in (0, 2, 4))

    def add_rgb_from_hex(self, file_path, out_path):
        with open(file_path, 'r') as file:
            colors = json.load(file)

        # 2. Loop through each color and add the RGB values
        for color in colors:
            color['rgb'] = self.hex_to_rgb(color['hex'])

        # 3. Save the updated data to a new file
        with open(out_path, 'w') as file:
            # indent=2 formats the file nicely with line breaks and spaces
            json.dump(colors, file, indent=2)

        print(f"RGB values successfully added and saved to {out_path}!")

# This block allows the script to be run directly from the terminal
if __name__ == "__main__":
    # Check if the user provided exactly 2 arguments (plus the script name)
    if len(sys.argv) != 3:
        print("Usage: python helper.py <in_path> <out_path>")
        sys.exit(1)

    # sys.argv[0] is the script name ('helper.py')
    in_path = sys.argv[1]
    out_path = sys.argv[2]

    # Initialize the class and call the function
    app = Helper()
    app.add_rgb_from_hex(in_path, out_path)