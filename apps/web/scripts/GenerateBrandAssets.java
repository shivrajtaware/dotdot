import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

public class GenerateBrandAssets {
  static final Color GREEN = new Color(20, 83, 45);
  static BufferedImage logo;
  static void drawContained(Graphics2D g, int x, int y, int w, int h) {
    double scale = Math.min((double)w / logo.getWidth(), (double)h / logo.getHeight());
    int rw = (int)(logo.getWidth() * scale), rh = (int)(logo.getHeight() * scale);
    g.drawImage(logo, x + (w-rw)/2, y + (h-rh)/2, rw, rh, null);
  }
  static BufferedImage icon(int size, boolean adaptive) {
    BufferedImage out = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
    Graphics2D g = out.createGraphics(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    if (!adaptive) { g.setColor(GREEN); g.fillRect(0,0,size,size); }
    int inset = (int)(size * (adaptive ? .08 : .08)); int d = size - inset*2;
    g.setColor(Color.WHITE); g.fillOval(inset,inset,d,d);
    int pad = (int)(d*.12); drawContained(g,inset+pad,inset+pad,d-2*pad,d-2*pad); g.dispose(); return out;
  }
  static void write(BufferedImage image, String path) throws Exception { File f=new File(path); f.getParentFile().mkdirs(); ImageIO.write(image,"png",f); }
  public static void main(String[] args) throws Exception {
    logo = ImageIO.read(new File("public/logo.jpg"));
    String root="android/app/src/main/res/";
    int[] sizes={48,72,96,144,192}; String[] dirs={"mipmap-mdpi","mipmap-hdpi","mipmap-xhdpi","mipmap-xxhdpi","mipmap-xxxhdpi"};
    for(int i=0;i<sizes.length;i++){BufferedImage standard=icon(sizes[i],false);write(standard,root+dirs[i]+"/ic_launcher.png");write(standard,root+dirs[i]+"/ic_launcher_round.png");write(icon(sizes[i]*4,true),root+dirs[i]+"/ic_launcher_foreground.png");}
    int[] splashSizes={512,640,768,960,1280}; String[] splashDirs={"drawable","drawable-port-mdpi","drawable-port-hdpi","drawable-port-xhdpi","drawable-port-xxhdpi"};
    for(int i=0;i<splashSizes.length;i++){int s=splashSizes[i];BufferedImage img=new BufferedImage(s,s,BufferedImage.TYPE_INT_RGB);Graphics2D g=img.createGraphics();g.setColor(new Color(247,250,247));g.fillRect(0,0,s,s);int badge=(int)(s*.52);g.setColor(Color.WHITE);g.fillOval((s-badge)/2,(s-badge)/2,badge,badge);drawContained(g,(s-badge)/2+badge/10,(s-badge)/2+badge/10,badge*8/10,badge*8/10);g.dispose();write(img,root+splashDirs[i]+"/splash.png");}
  }
}
